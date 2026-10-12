//! 图标渲染：把 `DefaultIcon` 值渲染为 PNG（供前端 `<img>` 在扩展名前直接预览）
//!
//! 流程（全程 best-effort，任一步失败都返回 `None`，前端回退到文字标签）：
//! 1. 解析 `"<文件>",<索引>`（与 `icon.rs::parse_icon_value` 同一套规则）
//! 2. `SHDefExtractIconW` 取 HICON —— 它支持**负数资源 ID**（如 `imageres.dll,-102`），
//!    而 `ExtractIconExW` 只认图标序号，故以前者为主、后者兜底正数索引
//! 3. `GetIconInfo` + `GetDIBits` 读成 32bpp BGRA；alpha 优先取位图自带通道，
//!    缺失时按 ICO 的 AND 掩码推断
//! 4. 按目标尺寸面积平均缩放
//! 5. 编码 PNG（zlib 的 stored block，无外部依赖）
//!
//! **这是继 `refresh.rs` 之后第二处允许 `unsafe` 的模块**：GDI 与 Shell 的图标 API
//! 只有 unsafe 绑定，所有调用点都标注 `// SAFETY：`。

use std::collections::HashMap;
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
};
use windows::Win32::UI::Shell::ExtractIconExW;
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

use crate::icon::parse_icon_value;

// `SHDefExtractIconW` 属 shell32 的历史 API（长期稳定、被广泛使用），
// windows crate 的绑定不保证存在，直接声明可避免版本差异。
#[link(name = "shell32")]
extern "system" {
    fn SHDefExtractIconW(
        psz_icon_file: *const u16,
        i_index: i32,
        u_flags: u32,
        ph_icon_large: *mut HICON,
        ph_icon_small: *mut HICON,
        n_icon_size: u32,
    ) -> i32;
}

/// 渲染结果：RGBA 像素
struct Rgba {
    width: u32,
    height: u32,
    data: Vec<u8>,
}

/// 把 UTF-8 路径转成以 NUL 结尾的宽字符缓冲
fn wide(path: &str) -> Vec<u16> {
    path.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 解析图标来源文件：绝对路径直接用，裸文件名（如 `imageres.dll`）按 System32 解析
fn resolve_icon_file(file: &str) -> Option<PathBuf> {
    if file.is_empty() {
        return None;
    }
    let path = Path::new(file);
    if path.is_absolute() {
        return Some(path.to_path_buf());
    }
    let root = std::env::var("SystemRoot").ok()?;
    Some(PathBuf::from(root).join("System32").join(path))
}

/// 取 HICON：先试支持负数资源 ID 的 `SHDefExtractIconW`，失败再退回 `ExtractIconExW`
fn extract_hicon(file: &Path, index: i32, size: u32) -> Option<HICON> {
    let wide_path = wide(&file.to_string_lossy());
    let mut large = HICON::default();

    // SAFETY：wide_path 以 NUL 结尾且在整个调用期间存活；ph_icon_small 传空表示不需要小图标；
    // n_icon_size 的高低 16 位分别是「大图标 / 小图标」尺寸，这里都填目标尺寸。
    let hr = unsafe {
        SHDefExtractIconW(
            wide_path.as_ptr(),
            index,
            0,
            &mut large,
            std::ptr::null_mut(),
            size | (size << 16),
        )
    };
    if hr >= 0 && !large.is_invalid() {
        return Some(large);
    }

    // 兜底：正数索引可用 ExtractIconExW
    if index >= 0 {
        let mut fallback = HICON::default();
        // SAFETY：同上，仅取大图标（第 3 个参数），nicons=1 表示处理一个图标。
        let count = unsafe {
            ExtractIconExW(
                PCWSTR(wide_path.as_ptr()),
                index,
                Some(&mut fallback),
                None,
                1,
            )
        };
        if count > 0 && !fallback.is_invalid() {
            return Some(fallback);
        }
    }

    None
}

/// 读取位图（`GetDIBits`）为 32bpp BGRA（自上而下）
fn read_bitmap_bgra(dc: windows::Win32::Graphics::Gdi::HDC, hbm: HBITMAP) -> Option<Rgba> {
    let mut bm = BITMAP::default();
    // SAFETY：bm 是有效的栈对象，长度按 BITMAP 传入；hbm 由 GetIconInfo 产出且调用期间有效。
    let got = unsafe {
        GetObjectW(
            HGDIOBJ(hbm.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut BITMAP as *mut c_void),
        )
    };
    if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
        return None;
    }

    let width = bm.bmWidth as u32;
    let height = bm.bmHeight as u32;
    let mut info = BITMAPINFO::default();
    info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    info.bmiHeader.biWidth = width as i32;
    info.bmiHeader.biHeight = -(height as i32); // 负高度 = 自上而下
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = 0; // BI_RGB

    let mut data = vec![0u8; (width * height * 4) as usize];
    // SAFETY：data 的容量与 biWidth/biHeight/biBitCount 一致；info 是有效栈对象。
    let lines = unsafe {
        GetDIBits(
            dc,
            hbm,
            0,
            height,
            Some(data.as_mut_ptr() as *mut c_void),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    if lines == 0 {
        return None;
    }

    Some(Rgba {
        width,
        height,
        data,
    })
}

/// 读取单色掩码位图并展开为「每位是否透明」（true = 透明）
fn read_mask_transparency(
    dc: windows::Win32::Graphics::Gdi::HDC,
    hbm: HBITMAP,
    width: u32,
    height: u32,
) -> Option<Vec<bool>> {
    let stride = width.div_ceil(32) * 4; // 每行 4 字节对齐
    let mut info = BITMAPINFO::default();
    info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    info.bmiHeader.biWidth = width as i32;
    info.bmiHeader.biHeight = -(height as i32);
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 1;

    let mut raw = vec![0u8; (stride * height) as usize];
    // SAFETY：raw 按 1bpp 行宽（4 字节对齐）分配，与 biBitCount=1 一致。
    let lines = unsafe {
        GetDIBits(
            dc,
            hbm,
            0,
            height,
            Some(raw.as_mut_ptr() as *mut c_void),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    if lines == 0 {
        return None;
    }

    let mut transparent = Vec::with_capacity((width * height) as usize);
    for y in 0..height {
        for x in 0..width {
            let byte = raw[(y * stride + x / 8) as usize];
            // 高位在前：bit = 1 表示该像素透明
            let bit = (byte >> (7 - (x % 8))) & 1;
            transparent.push(bit == 1);
        }
    }
    Some(transparent)
}

/// 取 HICON 的像素：颜色位图的 alpha 优先，缺失时用掩码推断
fn hicon_to_rgba(hicon: HICON) -> Option<Rgba> {
    let mut info = ICONINFO::default();
    // SAFETY：info 是有效栈对象；返回 Err 表示取图标信息失败，直接放弃。
    if unsafe { GetIconInfo(hicon, &mut info) }.is_err() {
        return None;
    }

    // 屏幕 DC 仅用于让 GetDIBits 确定调色板行为
    // SAFETY：传 NULL 窗口句柄获取屏幕 DC，用完立即 ReleaseDC。
    let dc = unsafe { GetDC(HWND::default()) };

    let mut rgba = read_bitmap_bgra(dc, info.hbmColor);
    if let Some(image) = rgba.as_mut() {
        let has_alpha = image.data.chunks_exact(4).any(|px| px[3] != 0);
        if !has_alpha {
            // 颜色位图不带 alpha（旧式图标）：退回 AND 掩码语义
            if let Some(transparent) = read_mask_transparency(dc, info.hbmMask, image.width, image.height)
            {
                for (index, pixel) in image.data.chunks_exact_mut(4).enumerate() {
                    pixel[3] = if transparent[index] { 0 } else { 255 };
                }
            } else {
                // 掩码也读不到：整体按不透明处理，避免出现全黑块
                for pixel in image.data.chunks_exact_mut(4) {
                    pixel[3] = 255;
                }
            }
        }
    }

    // SAFETY：dc 来自 GetDC，必须成对释放；两个位图由 GetIconInfo 创建，用完需 DeleteObject。
    unsafe {
        ReleaseDC(HWND::default(), dc);
        let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
        let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
    }

    rgba
}

/// 面积平均缩放（放大时退化为最近邻，避免出现空洞）
fn resize_area(src: &Rgba, size: u32) -> Rgba {
    if src.width == size && src.height == size {
        return Rgba {
            width: src.width,
            height: src.height,
            data: src.data.clone(),
        };
    }

    let mut out = vec![0u8; (size * size * 4) as usize];
    for y in 0..size {
        for x in 0..size {
            let sx0 = x * src.width / size;
            let sx1 = ((x + 1) * src.width).div_ceil(size).max(sx0 + 1);
            let sy0 = y * src.height / size;
            let sy1 = ((y + 1) * src.height).div_ceil(size).max(sy0 + 1);

            let (mut r, mut g, mut b, mut a, mut count) = (0u32, 0u32, 0u32, 0u32, 0u32);
            for sy in sy0..sy1.min(src.height) {
                for sx in sx0..sx1.min(src.width) {
                    let offset = ((sy * src.width + sx) * 4) as usize;
                    // 按 alpha 加权，避免透明像素把颜色拉黑
                    let alpha = src.data[offset + 3] as u32;
                    r += src.data[offset] as u32 * alpha;
                    g += src.data[offset + 1] as u32 * alpha;
                    b += src.data[offset + 2] as u32 * alpha;
                    a += alpha;
                    count += 1;
                }
            }

            let offset = ((y * size + x) * 4) as usize;
            // 按 alpha 加权求平均（a 为 alpha 总和，count 为像素数，均可能为 0）
            out[offset + 3] = a.checked_div(count.max(1)).unwrap_or(0) as u8;
            if a > 0 {
                out[offset] = r.checked_div(a).unwrap_or(0) as u8;
                out[offset + 1] = g.checked_div(a).unwrap_or(0) as u8;
                out[offset + 2] = b.checked_div(a).unwrap_or(0) as u8;
            }
        }
    }

    Rgba {
        width: size,
        height: size,
        data: out,
    }
}

// ---------- PNG 编码（纯函数，可单测） ----------

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in bytes {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn adler32(bytes: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in bytes {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

fn push_chunk(out: &mut Vec<u8>, kind: &[u8; 4], payload: &[u8]) {
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    let mut with_kind = Vec::with_capacity(4 + payload.len());
    with_kind.extend_from_slice(kind);
    with_kind.extend_from_slice(payload);
    out.extend_from_slice(&with_kind);
    out.extend_from_slice(&crc32(&with_kind).to_be_bytes());
}

/// zlib 流（stored block：不压缩，但格式完全合法）
fn zlib_stored(raw: &[u8]) -> Vec<u8> {
    let mut out = vec![0x78, 0x01]; // CMF/FLG：deflate、32K 窗口、无预设字典
    let mut chunks = raw.chunks(65_535).peekable();
    if chunks.peek().is_none() {
        // 空数据也要有一个合法的结束块
        out.extend_from_slice(&[0x01, 0x00, 0x00, 0xFF, 0xFF]);
    }
    for (index, chunk) in raw.chunks(65_535).enumerate() {
        let is_last = (index + 1) * 65_535 >= raw.len();
        out.push(if is_last { 0x01 } else { 0x00 }); // BFINAL + BTYPE=00
        out.extend_from_slice(&(chunk.len() as u16).to_le_bytes());
        out.extend_from_slice(&(!(chunk.len() as u16)).to_le_bytes());
        out.extend_from_slice(chunk);
    }
    out.extend_from_slice(&adler32(raw).to_be_bytes());
    out
}

/// 把 RGBA 像素编码为 PNG（8 位、颜色类型 6 = 真彩 + alpha）
fn encode_png(image: &Rgba) -> Vec<u8> {
    // 每行前置一个 filter 字节（0 = None）
    let stride = (image.width * 4) as usize;
    let mut raw = Vec::with_capacity((image.height as usize) * (stride + 1));
    for row in image.data.chunks_exact(stride) {
        raw.push(0);
        raw.extend_from_slice(row);
    }

    let mut out = Vec::with_capacity(raw.len() + 128);
    out.extend_from_slice(&PNG_SIGNATURE);

    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&image.width.to_be_bytes());
    ihdr.extend_from_slice(&image.height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]); // 位深 8、RGBA、无压缩/过滤/隔行选项
    push_chunk(&mut out, b"IHDR", &ihdr);
    push_chunk(&mut out, b"IDAT", &zlib_stored(&raw));
    push_chunk(&mut out, b"IEND", &[]);
    out
}

const BASE64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// 标准 base64 编码（data URL 用，带 `=` 填充）
fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(BASE64_TABLE[(triple >> 18) as usize & 0x3F] as char);
        out.push(BASE64_TABLE[(triple >> 12) as usize & 0x3F] as char);
        out.push(if chunk.len() > 1 {
            BASE64_TABLE[(triple >> 6) as usize & 0x3F] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_TABLE[triple as usize & 0x3F] as char
        } else {
            '='
        });
    }
    out
}

// ---------- 对外入口 ----------

/// 渲染缓存：`(DefaultIcon 值, 尺寸) → data URL`
type PreviewCache = Mutex<HashMap<(String, u32), Option<String>>>;

/// 同一个 DefaultIcon 值只提取一次（列表里大量扩展名共用同一图标）
fn cache() -> &'static PreviewCache {
    static CACHE: OnceLock<PreviewCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 把 DefaultIcon 值渲染成 PNG data URL；失败返回 None（前端回退文字标签）
pub fn render_data_url(value: &str, size: u32) -> Option<String> {
    let key = (value.to_string(), size);
    if let Ok(guard) = cache().lock() {
        if let Some(hit) = guard.get(&key) {
            return hit.clone();
        }
    }

    let rendered = render_uncached(value, size);

    if let Ok(mut guard) = cache().lock() {
        guard.insert(key, rendered.clone());
    }
    rendered
}

fn render_uncached(value: &str, size: u32) -> Option<String> {
    let (file, index) = parse_icon_value(value);
    let path = resolve_icon_file(&file)?;
    if !path.is_file() {
        return None;
    }

    let hicon = extract_hicon(&path, index.unwrap_or(0), size)?;
    let rgba = hicon_to_rgba(hicon);
    // SAFETY：hicon 由 SHDefExtractIconW / ExtractIconExW 产出，使用后必须销毁。
    unsafe {
        let _ = DestroyIcon(hicon);
    }

    let image = resize_area(&rgba?, size);
    let png = encode_png(&image);
    Some(format!("data:image/png;base64,{}", base64_encode(&png)))
}

/// 把 PNG 包装为 ICO 容器（Vista+ 支持 PNG 压缩条目）
///
/// Windows 的 `DefaultIcon` 只认 `.ico` / `.exe` / `.dll`，不认裸 PNG ——
/// 用户图标目录里的 `<扩展名>.png` 必须包装成 ICO 才能写入关联。
/// PNG 数据**原样**嵌入（不解码不缩放），宽高取自 IHDR（超 256 拒绝，
/// 因为 ICO 条目的宽高字段各只有 1 字节，256 用 0 表示）。
pub fn png_to_ico(png: &[u8]) -> Result<Vec<u8>, String> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if png.len() < 24 || png[..8] != *PNG_SIGNATURE {
        return Err("不是有效的 PNG 文件".to_string());
    }
    // IHDR：宽 16..20、高 20..24（大端）
    let width = u32::from_be_bytes(png[16..20].try_into().unwrap_or([0, 0, 0, 0]));
    let height = u32::from_be_bytes(png[20..24].try_into().unwrap_or([0, 0, 0, 0]));
    if width == 0 || height == 0 || width > 256 || height > 256 {
        return Err(format!("PNG 尺寸 {width}×{height} 超出 ICO 支持（1–256）"));
    }
    let entry_width = if width == 256 { 0u8 } else { width as u8 };
    let entry_height = if height == 256 { 0u8 } else { height as u8 };

    let mut out = Vec::with_capacity(22 + png.len());
    // ICONDIR：保留字 0、类型 1（图标）、数量 1
    out.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    // ICONDIRENTRY：宽、高、色数 0、保留 0、色面 1、位深 32
    out.extend_from_slice(&[entry_width, entry_height, 0, 0, 1, 0, 32, 0]);
    out.extend_from_slice(&(png.len() as u32).to_le_bytes());
    out.extend_from_slice(&22u32.to_le_bytes());
    out.extend_from_slice(png);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一个仅含头部的最小 PNG（够 png_to_ico 读取尺寸）
    fn fake_png(width: u32, height: u32) -> Vec<u8> {
        let mut png = Vec::new();
        png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        png.extend_from_slice(&[0, 0, 0, 13]);
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&width.to_be_bytes());
        png.extend_from_slice(&height.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0]);
        png.extend_from_slice(&[0u8; 64]);
        png
    }

    /// PNG 包装为 ICO：头、条目尺寸与偏移正确，图像数据原样保留
    #[test]
    fn png_wraps_into_ico() {
        let png = fake_png(64, 48);
        let ico = png_to_ico(&png).unwrap();
        assert_eq!(&ico[..6], &[0, 0, 1, 0, 1, 0]);
        assert_eq!(ico[6], 64);
        assert_eq!(ico[7], 48);
        let bytes_in_res = u32::from_le_bytes(ico[14..18].try_into().unwrap());
        assert_eq!(bytes_in_res as usize, png.len());
        let offset = u32::from_le_bytes(ico[18..22].try_into().unwrap());
        assert_eq!(offset as usize, 22);
        assert_eq!(&ico[22..], &png[..]);
    }

    /// 256×256 在条目里用 0 表示；超尺寸拒绝
    #[test]
    fn png_ico_size_rules() {
        let ico = png_to_ico(&fake_png(256, 256)).unwrap();
        assert_eq!(&ico[6..8], &[0, 0]);
        assert!(png_to_ico(&fake_png(300, 100)).is_err());
    }

    /// 非 PNG 数据拒绝
    #[test]
    fn png_ico_rejects_garbage() {
        assert!(png_to_ico(b"not a png").is_err());
    }

    fn solid(width: u32, height: u32, rgba: [u8; 4]) -> Rgba {
        let mut data = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..width * height {
            data.extend_from_slice(&rgba);
        }
        Rgba {
            width,
            height,
            data,
        }
    }

    /// base64：长度与填充规则
    #[test]
    fn base64_encoding() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        // 覆盖三种余数分支
        for len in 1..=32usize {
            let data: Vec<u8> = (0..len).map(|i| (i * 7) as u8).collect();
            let encoded = base64_encode(&data);
            assert_eq!(encoded.len() % 4, 0, "长度 {len}");
            assert_eq!(encoded.matches('=').count(), (3 - len % 3) % 3);
        }
    }

    /// CRC32 / Adler32 的已知值
    #[test]
    fn checksums() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(adler32(b"Wikipedia"), 0x11E6_0398);
    }

    /// PNG 结构：签名、块顺序、IHDR 尺寸与颜色类型
    #[test]
    fn png_structure() {
        let image = solid(4, 2, [255, 0, 0, 255]);
        let png = encode_png(&image);

        assert_eq!(&png[..8], &PNG_SIGNATURE);
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(u32::from_be_bytes([png[16], png[17], png[18], png[19]]), 4);
        assert_eq!(u32::from_be_bytes([png[20], png[21], png[22], png[23]]), 2);
        assert_eq!(png[24], 8); // 位深
        assert_eq!(png[25], 6); // RGBA
        assert!(png.ends_with(&[0xAE, 0x42, 0x60, 0x82])); // IEND 的 CRC 固定
    }

    /// zlib 流：头部、块长度字段、结尾 adler32
    #[test]
    fn zlib_stream_shape() {
        let raw = vec![7u8; 100];
        let stream = zlib_stored(&raw);
        assert_eq!(stream[0], 0x78);
        // stored block 头：BFINAL|BTYPE、LEN、NLEN
        assert_eq!(stream[2], 0x01);
        assert_eq!(u16::from_le_bytes([stream[3], stream[4]]), 100);
        assert_eq!(u16::from_le_bytes([stream[5], stream[6]]), !100u16);
        assert_eq!(stream.len(), 2 + 5 + 100 + 4);

        // 超过 65535 时切块：首块 BFINAL=0，末块 BFINAL=1
        let big = vec![0u8; 70_000];
        let tail = 70_000usize - 65_535; // 末块承载的剩余字节
        let stream = zlib_stored(&big);
        assert_eq!(stream[2], 0x00, "首块的 BFINAL 应为 0");
        let second_block = 2 + 5 + 65_535; // 头部 2 字节 + 首块（5 字节头 + 数据）
        assert_eq!(stream[second_block], 0x01, "末块的 BFINAL 应为 1");
        assert_eq!(
            u16::from_le_bytes([stream[second_block + 1], stream[second_block + 2]]),
            tail as u16,
            "末块长度应为剩余字节数"
        );
        assert_eq!(stream.len(), 2 + 5 + 65_535 + 5 + tail + 4);
    }

    /// 缩放：面积平均后颜色仍为纯色；尺寸正确
    #[test]
    fn resize_keeps_color() {
        let src = solid(32, 32, [10, 200, 30, 255]);
        let dst = resize_area(&src, 16);
        assert_eq!((dst.width, dst.height), (16, 16));
        assert_eq!(dst.data.len(), 16 * 16 * 4);
        assert_eq!(&dst.data[..4], &[10, 200, 30, 255]);

        // 同尺寸直接返回
        let same = resize_area(&src, 32);
        assert_eq!(same.data.len(), src.data.len());
    }

    /// 路径解析：绝对路径直通，裸文件名落到 System32
    #[test]
    fn icon_file_resolution() {
        assert_eq!(
            resolve_icon_file(r"C:\Windows\System32\imageres.dll"),
            Some(PathBuf::from(r"C:\Windows\System32\imageres.dll"))
        );
        assert!(resolve_icon_file("").is_none());
        if std::env::var("SystemRoot").is_ok() {
            let resolved = resolve_icon_file("imageres.dll").expect("应解析到 System32");
            assert!(resolved.to_string_lossy().to_ascii_lowercase().contains("system32"));
        }
    }

    /// 跨端闭环：按前端 `lib/ico.ts::packIco` 的结构手工构造 ICO，
    /// 再交给系统 API 读回 —— 以此验证前端生成的 .ico 文件 Windows 能认。
    #[test]
    fn ico_container_is_readable_by_system() {
        let png = encode_png(&solid(16, 16, [255, 0, 0, 255]));

        let mut ico = Vec::new();
        ico.extend_from_slice(&0u16.to_le_bytes()); // 保留位
        ico.extend_from_slice(&1u16.to_le_bytes()); // 类型：1 = 图标
        ico.extend_from_slice(&1u16.to_le_bytes()); // 图像数量
        ico.push(16); // 宽
        ico.push(16); // 高
        ico.push(0); // 调色板颜色数
        ico.push(0); // 保留位
        ico.extend_from_slice(&1u16.to_le_bytes()); // 色彩平面
        ico.extend_from_slice(&32u16.to_le_bytes()); // 位深
        ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
        ico.extend_from_slice(&22u32.to_le_bytes()); // 数据偏移 = 6 + 16
        ico.extend_from_slice(&png);

        let path = std::env::temp_dir().join("rsicon-ico-container-test.ico");
        std::fs::write(&path, &ico).expect("写临时 ICO 失败");

        let value = format!("\"{}\",0", path.display());
        let rendered = render_data_url(&value, 16);
        let _ = std::fs::remove_file(&path);

        let url = rendered.expect("系统应能读取按此结构生成的 ICO");
        assert!(url.contains("iVBORw0KGgo"), "读回的应仍是有效 PNG 数据");
    }

    /// 端到端：真实系统图标应能渲染出 PNG（本机必然存在 imageres.dll）
    #[test]
    fn renders_system_icon() {
        if let Some(url) = render_data_url("imageres.dll,-102", 16) {
            assert!(url.starts_with("data:image/png;base64,"));
            assert!(url.len() > 200, "PNG 数据不应过短");
        }
        // 不存在的图标必须安全返回 None，不能 panic
        assert!(render_data_url(r#""C:\__nope__\x.ico",0"#, 16).is_none());
    }

    /// 探针：打印若干真实图标的渲染结果，便于人工确认渲染链路是否真的走通
    /// （`cargo test render_probe -- --nocapture`）
    #[test]
    fn render_probe() {
        let cases = [
            "imageres.dll,-102",
            "imageres.dll,-101",
            r#""C:\Windows\System32\shell32.dll",3"#,
            r#""C:\Windows\explorer.exe",0"#,
        ];
        for value in cases {
            match render_data_url(value, 16) {
                Some(url) => {
                    let payload = url.split_once(',').map(|(_, b)| b).unwrap_or("");
                    let valid_png = payload.starts_with("iVBORw0KGgo");
                    println!(
                        "[探针] {value} → {} 字节，PNG 头{}",
                        payload.len(),
                        if valid_png { "有效" } else { "无效！" }
                    );
                    assert!(valid_png, "{value} 的 data URL 不是合法 PNG");
                }
                None => println!("[探针] {value} → 渲染失败"),
            }
        }
    }
}
