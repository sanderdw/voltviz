# Third-party notices

VoltViz is MIT licensed (see `LICENSE`) **except for the material listed under
"Not covered by the MIT license" below**, which keeps its own license.

The production build writes `third-party-notices.txt` next to `index.html`
(https://voltviz.com/third-party-notices.txt): this file followed by the full license text of
every npm package that is bundled into the site. The bundled packages are MIT, ISC,
BSD-3-Clause and Apache-2.0 licensed (among them react, three, d3-geo, lucide-react,
onnxruntime-web, @sendspin/sendspin-js and the libopus decoder of opus-encdec).

## Not covered by the MIT license

### Moss Ball visualizer (`src/visualizers/impl/MossBall.ts`)

The vertex and fragment shaders are taken unchanged from **imoss** by ledhieu
(https://github.com/ledhieu/imoss, https://imoss.bio), licensed
**Creative Commons Attribution-NonCommercial 4.0 International** (CC BY-NC 4.0,
https://creativecommons.org/licenses/by-nc/4.0/). VoltViz changed the host code (plain
three.js, audio-reactive uniforms). These shaders may not be used for commercial purposes.

### Flame visualizer (`src/visualizers/impl/Flame.ts`)

The fragment shader is adapted from the flame shader by kuvkar on Shadertoy
(https://www.shadertoy.com/view/4tXXRn). Shadertoy code without an explicit license is
licensed **Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported**
(CC BY-NC-SA 3.0, https://creativecommons.org/licenses/by-nc-sa/3.0/). VoltViz added audio
uniforms, hue shift and sensitivity.

## Other third-party material

### Halftone Pulse visualizer (`src/visualizers/impl/HalftonePulse.tsx`)

The shape library and the image-to-shape grid are ported from "Dither / ASCII Effect Pro" by
sabosugi (https://codepen.io/sabosugi/pen/bNegbmy). Public CodePen pens are MIT licensed:

> Copyright (c) sabosugi (https://codepen.io/sabosugi)
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### Beat model (`public/models/beat_this_small0.onnx`)

*Beat This!* small0 by the Institute of Computational Perception, JKU Linz (MIT). Details and
the license text: `public/models/NOTICE.md` (served as `models/NOTICE.md`).

### Dutch municipality boundaries (`src/data/Netherlands_gemeentes.json`)

Generalized municipality boundaries 2023 (`gemeente_gegeneraliseerd`) of Statistics
Netherlands (CBS) and Kadaster, published via PDOK under Creative Commons Attribution 4.0
(CC BY 4.0, https://creativecommons.org/licenses/by/4.0/). Source: © CBS, Kadaster.
Used by the Dutch Grid visualizers.

## Trademarks

Winamp, Windows 95, Disney, Defqon.1, Razor 1911, Music Assistant, Home Assistant and other
names used for visualizers, skins and integrations are trademarks of their respective owners.
They are used descriptively; VoltViz is not affiliated with or endorsed by them.
