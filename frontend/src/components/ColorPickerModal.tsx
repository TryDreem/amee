import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

import { COLOR_SWATCH_GRID, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, type Hsv } from "../lib/color";
import { UI_MODES, type Prefs } from "../theme";

interface ColorPickerModalProps {
  prefs: Prefs;
  hex: string;
  alpha: number;
  onChange: (hex: string, alpha: number) => void;
  onClose: () => void;
  // false for fields with no alpha in the wire schema (highlightColors is a plain string[],
  // contract §8) — hides the alpha slider/field rather than showing a control that has no effect.
  showAlpha?: boolean;
}

// Full HSV picker ported from the design's color modal (openColorModal/commitColorModal/
// buildColorModalVals) — palette grid, saturation-value box, hue slider, alpha slider, and
// hex/R/G/B/A numeric fields. Keyed by the caller on whichever field is being edited, so a
// fresh instance re-derives h/s/v from that field's current hex on open.
export default function ColorPickerModal({
  prefs,
  hex,
  alpha,
  onChange,
  onClose,
  showAlpha = true,
}: ColorPickerModalProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const [hsv, setHsv] = useState<Hsv>(() => {
    const rgb = hexToRgb(hex);
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  });
  const [a, setA] = useState(alpha);
  const svBoxRef = useRef<HTMLDivElement>(null);

  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const currentHex = rgbToHex(rgb.r, rgb.g, rgb.b);

  useEffect(() => {
    onChange(currentHex, a);
    // Only re-fire when the derived color/alpha actually changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHex, a]);

  function updateFromClientPoint(clientX: number, clientY: number) {
    const rect = svBoxRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const s = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const v = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height));
    setHsv((prev) => ({ ...prev, s, v }));
  }

  function startSvDrag(ev: ReactMouseEvent<HTMLDivElement>) {
    updateFromClientPoint(ev.clientX, ev.clientY);
    const onMove = (e: MouseEvent) => updateFromClientPoint(e.clientX, e.clientY);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function applyHexInput(value: string) {
    const clean = value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
    if (clean.length === 6) {
      const nrgb = hexToRgb("#" + clean);
      setHsv(rgbToHsv(nrgb.r, nrgb.g, nrgb.b));
    }
  }

  function applyChannel(channel: "r" | "g" | "b", raw: string) {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) {
      return;
    }
    const clamped = Math.max(0, Math.min(255, n));
    const next = { ...rgb, [channel]: clamped };
    setHsv(rgbToHsv(next.r, next.g, next.b));
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    textAlign: "center",
    border: "1px solid " + mode.cardBorder,
    borderRadius: "8px",
    padding: "6px 4px",
    fontSize: "12px",
    color: mode.textMain,
    background: mode.inputBg,
  };
  const fieldLabelStyle: CSSProperties = { fontSize: "10px", color: mode.textFaint3 };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.4)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "260px",
          background: mode.frameBg,
          borderRadius: "14px",
          padding: "18px",
          boxShadow: "0 24px 60px rgba(0,0,0,.4)",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          border: "1px solid " + mode.cardBorder,
        }}
      >
        <div
          onClick={onClose}
          style={{
            position: "absolute",
            top: "-14px",
            right: "-14px",
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            background: mode.iconBg,
            boxShadow: "0 4px 12px rgba(0,0,0,.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: "12px",
            color: mode.iconText,
          }}
        >
          ✕
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: "6px" }}>
          {COLOR_SWATCH_GRID.map((c) => (
            <div
              key={c}
              onClick={() => {
                const nrgb = hexToRgb(c);
                setHsv(rgbToHsv(nrgb.r, nrgb.g, nrgb.b));
              }}
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "50%",
                cursor: "pointer",
                background: c,
                border: "1px solid rgba(128,128,128,.25)",
              }}
            />
          ))}
        </div>

        <div style={{ height: "1px", background: mode.panelBorder2 }} />

        <div
          ref={svBoxRef}
          onMouseDown={startSvDrag}
          style={{
            position: "relative",
            width: "100%",
            height: "140px",
            borderRadius: "8px",
            cursor: "crosshair",
            backgroundColor: `hsl(${hsv.h},100%,50%)`,
            backgroundImage:
              "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              width: "14px",
              height: "14px",
              marginLeft: "-7px",
              marginTop: "-7px",
              borderRadius: "50%",
              border: "2px solid #fff",
              boxShadow: "0 0 0 1px rgba(0,0,0,.4)",
              background: currentHex,
              pointerEvents: "none",
            }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={Math.round(hsv.h)}
          onChange={(e) => setHsv((prev) => ({ ...prev, h: Number(e.target.value) }))}
          style={{
            width: "100%",
            height: "14px",
            borderRadius: "7px",
            appearance: "none",
            WebkitAppearance: "none",
            background: "linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)",
            outline: "none",
          }}
        />

        {showAlpha && (
          <div
            style={{
              borderRadius: "7px",
              overflow: "hidden",
              backgroundImage:
                "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
              backgroundSize: "10px 10px",
              backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0",
            }}
          >
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={a}
              onChange={(e) => setA(Number(e.target.value))}
              style={{
                width: "100%",
                height: "14px",
                borderRadius: "7px",
                appearance: "none",
                WebkitAppearance: "none",
                outline: "none",
                background: `linear-gradient(to right, transparent, ${currentHex})`,
              }}
            />
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: showAlpha ? "1.4fr 1fr 1fr 1fr 1fr" : "1.4fr 1fr 1fr 1fr",
            gap: "6px",
          }}
        >
          <div>
            <input
              type="text"
              value={currentHex.replace("#", "").toUpperCase()}
              onChange={(e) => applyHexInput(e.target.value)}
              style={inputStyle}
            />
            <div style={fieldLabelStyle}>Hex</div>
          </div>
          <div>
            <input
              type="text"
              inputMode="numeric"
              value={Math.round(rgb.r)}
              onChange={(e) => applyChannel("r", e.target.value)}
              style={inputStyle}
            />
            <div style={fieldLabelStyle}>R</div>
          </div>
          <div>
            <input
              type="text"
              inputMode="numeric"
              value={Math.round(rgb.g)}
              onChange={(e) => applyChannel("g", e.target.value)}
              style={inputStyle}
            />
            <div style={fieldLabelStyle}>G</div>
          </div>
          <div>
            <input
              type="text"
              inputMode="numeric"
              value={Math.round(rgb.b)}
              onChange={(e) => applyChannel("b", e.target.value)}
              style={inputStyle}
            />
            <div style={fieldLabelStyle}>B</div>
          </div>
          {showAlpha && (
            <div>
              <input
                type="text"
                inputMode="numeric"
                value={a}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) {
                    setA(Math.max(0, Math.min(100, n)));
                  }
                }}
                style={inputStyle}
              />
              <div style={fieldLabelStyle}>A</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
