import { validDeviceIcon } from "../../sidebarPersonalization";

export async function createDeviceIconImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const maxEdge of [256, 128]) {
      const edge = Math.min(maxEdge, Math.max(bitmap.width, bitmap.height));
      const scale = edge / Math.max(bitmap.width, bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = edge;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create the image.");
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, (edge - width) / 2, (edge - height) / 2, width, height);
      const image = canvas.toDataURL("image/png");
      if (image.startsWith("data:image/png;base64,") && validDeviceIcon(image)) return image;
    }
    throw new Error("Could not fit the image within the icon size limit.");
  } finally {
    bitmap.close();
  }
}
