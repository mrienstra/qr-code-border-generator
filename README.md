# QR Code Border Generator

Generates decorative borders around QR codes by mirroring the code's own data pattern, clipped to a circle or rounded square.

<p align="center">
  <img src="qr-code-generated.svg" alt="Example QR code with circular border" width="400">
</p>

**[Try it live](https://mrienstra.github.io/qr-code-border-generator/)**

## How it works

A standard QR code has three finder patterns (the large squares in three corners) and a data region. This tool takes the QR code's data pattern and creates mirrored/flipped copies on all four sides, producing a seamless decorative border:

1. **Edge trimming** -- Each side's copy has its finder pattern zones removed to avoid overlap. The top copy trims its left and right edges, the left copy trims top and bottom, etc.
2. **Flanking repetition** -- For sides that need more coverage (top and left), additional alternating-mirror copies tile outward.
3. **Diagonal trimming** -- A 45-degree "no man's land" at each corner prevents adjacent groups (e.g. top and right) from overlapping.
4. **Clip path** -- Everything is clipped to a border shape (circle or rounded square), and a stroke is drawn on top.

The result is a QR code that remains fully scannable while being surrounded by a pattern derived from its own data.

## Features

- **Interactive browser UI** with live preview
- **Generate QR codes** directly from text, or upload an existing SVG
- **Border shapes**: circle or square with adjustable corner radius
- **Customizable colors**: interior (foreground), border stroke, and background (with alpha)
- **Background shape**: full rectangle or matching the border shape
- **Adjustable size ratio** and stroke width
- **Download** as SVG
- **Node CLI** for batch/scripted processing

## CLI usage

```
node generate_border.mjs [input.svg] [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-o`, `--output` | `qr-code-generated.svg` | Output file path |
| `--colorful` | `false` | Debug mode: color each group differently |
| `--circle-ratio` | `0.818182` | Size of border shape relative to QR code |
| `--stroke-width` | `2` | Border stroke width |
| `--border-shape` | `circle` | `circle` or `square` |
| `--corner-radius` | `0` | Corner radius for square border (0--1) |
| `--fg-color` | `#000000` | Interior / foreground color |
| `--border-color` | `#000000` | Border stroke color |
| `--bg-color` | `#ffffff` | Background color |
| `--bg-shape` | `rect` | Background shape: `rect` or `circle` |

### Examples

```bash
# Default circle border
node generate_border.mjs qr-code-original.svg

# Square border with rounded corners
node generate_border.mjs qr-code-original.svg --border-shape square --corner-radius 0.3

# Custom colors, larger border
node generate_border.mjs qr-code-original.svg --circle-ratio 1.0 --fg-color "#1a1a2e" --border-color "#e94560"
```

## Credits

QR code generation in the browser uses the [QR Code Generator Library](https://www.nayuki.io/page/qr-code-generator-library) by Project Nayuki (MIT License).

## License

MIT
