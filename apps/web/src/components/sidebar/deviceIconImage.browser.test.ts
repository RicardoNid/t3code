import { expect, it } from "vite-plus/test";
import { createDeviceIconImage } from "./deviceIconImage";

it("reduces the thumbnail further when PNG encoding would exceed the saved icon budget", async () => {
  const source = document.createElement("canvas");
  source.width = source.height = 256;
  const context = source.getContext("2d")!;
  const pixels = context.createImageData(256, 256);
  let seed = 12345;
  for (let i = 0; i < pixels.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels.data[i + channel] = seed >>> 24;
    }
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const jpeg = await (await fetch(source.toDataURL("image/jpeg", 0.9))).blob();
  expect(jpeg.size).toBeLessThanOrEqual(131072);
  const image = await createDeviceIconImage(new File([jpeg], "photo.jpg", { type: jpeg.type }));
  expect(image).toMatch(/^data:image\/png;base64,/);
  expect(image.length).toBeLessThanOrEqual(180000);
  const thumbnail = await createImageBitmap(await (await fetch(image)).blob());
  using cleanup = new DisposableStack();
  cleanup.defer(() => thumbnail.close());
  expect([thumbnail.width, thumbnail.height]).toEqual([128, 128]);
});
