import { describe, expect, it } from "vitest";

import { colorWithAlpha, hexToRgb, hsvToRgb, parseColorString, rgbToHex, rgbToHsv } from "./color";

describe("color conversions", () => {
  it("round-trips hex -> rgb -> hex", () => {
    expect(rgbToHex(...Object.values(hexToRgb("#ff5c5c")) as [number, number, number])).toBe(
      "#ff5c5c"
    );
  });

  it("round-trips rgb -> hsv -> rgb within rounding tolerance", () => {
    const rgb = { r: 0, g: 229, b: 160 };
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
    expect(Math.round(back.r)).toBeCloseTo(rgb.r, 0);
    expect(Math.round(back.g)).toBeCloseTo(rgb.g, 0);
    expect(Math.round(back.b)).toBeCloseTo(rgb.b, 0);
  });

  it("hsvToRgb(0,0,0) is black, hsvToRgb(0,0,1) is white", () => {
    expect(rgbToHex(hsvToRgb(0, 0, 0).r, hsvToRgb(0, 0, 0).g, hsvToRgb(0, 0, 0).b)).toBe("#000000");
    expect(rgbToHex(hsvToRgb(0, 0, 1).r, hsvToRgb(0, 0, 1).g, hsvToRgb(0, 0, 1).b)).toBe("#ffffff");
  });

  it("colorWithAlpha returns the plain hex at alpha 100", () => {
    expect(colorWithAlpha("#00e5a0", 100)).toBe("#00e5a0");
  });

  it("colorWithAlpha returns an rgba() string below 100", () => {
    expect(colorWithAlpha("#00e5a0", 50)).toBe("rgba(0,229,160,0.5)");
  });

  it("parseColorString is the inverse of colorWithAlpha", () => {
    expect(parseColorString(colorWithAlpha("#00e5a0", 50))).toEqual({ hex: "#00e5a0", alpha: 50 });
    expect(parseColorString(colorWithAlpha("#00e5a0", 100))).toEqual({ hex: "#00e5a0", alpha: 100 });
  });

  it("parseColorString treats a plain hex as fully opaque", () => {
    expect(parseColorString("#ff5c5c")).toEqual({ hex: "#ff5c5c", alpha: 100 });
  });
});
