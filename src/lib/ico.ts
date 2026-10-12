// SVG → ICO 转换（纯前端实现，不引入任何依赖）
//
// 流程：SVG 文本 → Blob → Image → Canvas 光栅化 → PNG 字节 → ICO 容器
//
// ICO 采用 Vista+ 支持的「PNG 内嵌」形式：
//   ICONDIR(6B) + ICONDIRENTRY×N(16B each) + PNG 数据
// 现代 Windows 都能正确读取；单尺寸上限 256（字节位 0 表示 256）。

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

export interface IcoEntry {
  size: number;
  png: Uint8Array;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法解析 SVG 内容（请确认文件是合法的 SVG）"));
    image.src = url;
  });
}

/** 光栅化 SVG 为指定尺寸的 PNG 字节 */
export async function rasterizeSvg(svg: string, size: number): Promise<Uint8Array> {
  if (svg.trim() === "") {
    throw new Error("SVG 内容为空");
  }
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("当前环境不支持画布绘制");
    }
    context.clearRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);

    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) {
      throw new Error("PNG 编码失败");
    }
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 把若干尺寸的 PNG 打包成 ICO（结构见文件头注释） */
export function packIco(entries: IcoEntry[]): Uint8Array {
  if (entries.length === 0) {
    throw new Error("至少需要选择一个尺寸");
  }

  const headerSize = 6 + entries.length * 16;
  const payloadSize = entries.reduce((sum, entry) => sum + entry.png.length, 0);
  const out = new Uint8Array(headerSize + payloadSize);
  const view = new DataView(out.buffer);

  view.setUint16(0, 0, true); // 保留位
  view.setUint16(2, 1, true); // 类型：1 = 图标
  view.setUint16(4, entries.length, true); // 图像数量

  let offset = headerSize;
  entries.forEach((entry, index) => {
    const base = 6 + index * 16;
    const dimension = entry.size >= 256 ? 0 : entry.size; // 0 表示 256
    out[base] = dimension;
    out[base + 1] = dimension;
    out[base + 2] = 0; // 调色板颜色数（真彩为 0）
    out[base + 3] = 0; // 保留位
    view.setUint16(base + 4, 1, true); // 色彩平面
    view.setUint16(base + 6, 32, true); // 位深
    view.setUint32(base + 8, entry.png.length, true);
    view.setUint32(base + 12, offset, true);
    out.set(entry.png, offset);
    offset += entry.png.length;
  });

  return out;
}

/** 由所选尺寸生成完整 ICO 字节 */
export async function buildIco(svg: string, sizes: number[]): Promise<Uint8Array> {
  const sorted = [...new Set(sizes)].sort((a, b) => a - b);
  if (sorted.length === 0) {
    throw new Error("至少需要选择一个尺寸");
  }
  const entries: IcoEntry[] = [];
  for (const size of sorted) {
    entries.push({ size, png: await rasterizeSvg(svg, size) });
  }
  return packIco(entries);
}

/** 人类可读的字节数 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** SVG 文本 → data URL（用于对话框内的即时预览，避免特殊字符/编码问题） */
export function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
