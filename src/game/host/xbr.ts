import { HEIGHT, WIDTH } from "./shared.ts";

// The Enhanced view: each 320x200 frame is drawn straight to the canvas's device pixels through Hyllian's xBR-lv2
// pixel-art scaler (libretro glsl-shaders xbr/shaders/xbr-lv2.glsl, default parameters: CORNER_C, smooth tips, no
// small-details mode), ported to GLSL ES 3.00. It works at any scale; XBR_SCALE is the actual one, so the blended
// edges stay one device pixel wide.

/*
   Hyllian's xBR-lv2 Shader

   Copyright (C) 2011-2016 Hyllian - sergiogdb@gmail.com

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in
   all copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   THE SOFTWARE.

   Incorporates some of the ideas from SABR shader. Thanks to Joshua Street.
*/

// One triangle covering the canvas; frame row 0 at the top.
const VERTEX = `#version 300 es
uniform vec2 TextureSize;
out vec2 texCoord;
out vec4 t1;
out vec4 t2;
out vec4 t3;
out vec4 t4;
out vec4 t5;
out vec4 t6;
out vec4 t7;

void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
  vec2 TexCoord = vec2(corner.x, 1.0 - corner.y);

  float dx = 1.0 / TextureSize.x;
  float dy = 1.0 / TextureSize.y;

  texCoord = TexCoord;
  texCoord.x *= 1.00000001;
  t1 = TexCoord.xxxy + vec4(-dx, 0, dx, -2.0 * dy); // A1 B1 C1
  t2 = TexCoord.xxxy + vec4(-dx, 0, dx, -dy);       //  A  B  C
  t3 = TexCoord.xxxy + vec4(-dx, 0, dx, 0);         //  D  E  F
  t4 = TexCoord.xxxy + vec4(-dx, 0, dx, dy);        //  G  H  I
  t5 = TexCoord.xxxy + vec4(-dx, 0, dx, 2.0 * dy);  // G5 H5 I5
  t6 = TexCoord.xyyy + vec4(-2.0 * dx, -dy, 0, dy); // A0 D0 G0
  t7 = TexCoord.xyyy + vec4(2.0 * dx, -dy, 0, dy);  // C4 F4 I4
}
`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 TextureSize;
uniform float XBR_SCALE;
uniform sampler2D decal;
in vec2 texCoord;
in vec4 t1;
in vec4 t2;
in vec4 t3;
in vec4 t4;
in vec4 t5;
in vec4 t6;
in vec4 t7;
out vec4 FragColor;

const float XBR_EQ_THRESHOLD = 15.0;
const float lv2_cf = 2.0;
const vec3 rgbw = vec3(14.352, 28.176, 5.472);

const vec4 Ao = vec4(1.0, -1.0, -1.0, 1.0);
const vec4 Bo = vec4(1.0, 1.0, -1.0, -1.0);
const vec4 Co = vec4(1.5, 0.5, -0.5, 0.5);
const vec4 Ax = vec4(1.0, -1.0, -1.0, 1.0);
const vec4 Bx = vec4(0.5, 2.0, -0.5, -2.0);
const vec4 Cx = vec4(1.0, 1.0, -0.5, 0.0);
const vec4 Ay = vec4(1.0, -1.0, -1.0, 1.0);
const vec4 By = vec4(2.0, 0.5, -2.0, -0.5);
const vec4 Cy = vec4(2.0, 0.0, -1.0, 0.5);
const vec4 Ci = vec4(0.25, 0.25, 0.25, 0.25);

// Difference between vector components.
vec4 df(vec4 A, vec4 B) {
  return vec4(abs(A - B));
}

// Compare two vectors and return their components are different.
vec4 diff(vec4 A, vec4 B) {
  return vec4(notEqual(A, B));
}

// Determine if two vector components are equal based on a threshold.
vec4 eq(vec4 A, vec4 B) {
  return step(df(A, B), vec4(XBR_EQ_THRESHOLD));
}

// Determine if two vector components are NOT equal based on a threshold.
vec4 neq(vec4 A, vec4 B) {
  return vec4(1.0, 1.0, 1.0, 1.0) - eq(A, B);
}

// Weighted distance.
vec4 wd(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 f, vec4 g, vec4 h) {
  return df(a, b) + df(a, c) + df(d, e) + df(d, f) + 4.0 * df(g, h);
}

float c_df(vec3 c1, vec3 c2) {
  vec3 df = abs(c1 - c2);
  return df.r + df.g + df.b;
}

void main() {
  vec4 delta = vec4(1.0 / XBR_SCALE);
  vec4 delta_l = vec4(0.5 / XBR_SCALE, 1.0 / XBR_SCALE, 0.5 / XBR_SCALE, 1.0 / XBR_SCALE);
  vec4 delta_u = delta_l.yxwz;

  vec4 edri, edr, edr_l, edr_u, px; // px = pixel, edr = edge detection rule
  vec4 irlv0, irlv1, irlv2l, irlv2u;
  vec4 fx, fx_l, fx_u; // inequations of straight lines.

  vec2 fp = fract(texCoord * TextureSize);

  vec3 A1 = texture(decal, t1.xw).xyz;
  vec3 B1 = texture(decal, t1.yw).xyz;
  vec3 C1 = texture(decal, t1.zw).xyz;
  vec3 A  = texture(decal, t2.xw).xyz;
  vec3 B  = texture(decal, t2.yw).xyz;
  vec3 C  = texture(decal, t2.zw).xyz;
  vec3 D  = texture(decal, t3.xw).xyz;
  vec3 E  = texture(decal, t3.yw).xyz;
  vec3 F  = texture(decal, t3.zw).xyz;
  vec3 G  = texture(decal, t4.xw).xyz;
  vec3 H  = texture(decal, t4.yw).xyz;
  vec3 I  = texture(decal, t4.zw).xyz;
  vec3 G5 = texture(decal, t5.xw).xyz;
  vec3 H5 = texture(decal, t5.yw).xyz;
  vec3 I5 = texture(decal, t5.zw).xyz;
  vec3 A0 = texture(decal, t6.xy).xyz;
  vec3 D0 = texture(decal, t6.xz).xyz;
  vec3 G0 = texture(decal, t6.xw).xyz;
  vec3 C4 = texture(decal, t7.xy).xyz;
  vec3 F4 = texture(decal, t7.xz).xyz;
  vec3 I4 = texture(decal, t7.xw).xyz;

  vec4 b = vec4(dot(B, rgbw), dot(D, rgbw), dot(H, rgbw), dot(F, rgbw));
  vec4 c = vec4(dot(C, rgbw), dot(A, rgbw), dot(G, rgbw), dot(I, rgbw));
  vec4 d = b.yzwx;
  vec4 e = vec4(dot(E, rgbw));
  vec4 f = b.wxyz;
  vec4 g = c.zwxy;
  vec4 h = b.zwxy;
  vec4 i = c.wxyz;

  vec4 i4 = vec4(dot(I4, rgbw), dot(C1, rgbw), dot(A0, rgbw), dot(G5, rgbw));
  vec4 i5 = vec4(dot(I5, rgbw), dot(C4, rgbw), dot(A1, rgbw), dot(G0, rgbw));
  vec4 h5 = vec4(dot(H5, rgbw), dot(F4, rgbw), dot(B1, rgbw), dot(D0, rgbw));
  vec4 f4 = h5.yzwx;

  // These inequations define the line below which interpolation occurs.
  fx   = (Ao * fp.y + Bo * fp.x);
  fx_l = (Ax * fp.y + Bx * fp.x);
  fx_u = (Ay * fp.y + By * fp.x);

  irlv1 = irlv0 = diff(e, f) * diff(e, h);

  // CORNER_C
  irlv1 = (irlv0 * (neq(f, b) * neq(f, c) + neq(h, d) * neq(h, g) + eq(e, i) * (neq(f, f4) * neq(f, i4) + neq(h, h5) * neq(h, i5)) + eq(e, g) + eq(e, c)));

  irlv2l = diff(e, g) * diff(d, g);
  irlv2u = diff(e, c) * diff(b, c);

  vec4 fx45i = clamp((fx + delta - Co - Ci) / (2.0 * delta), 0.0, 1.0);
  vec4 fx45  = clamp((fx + delta - Co) / (2.0 * delta), 0.0, 1.0);
  vec4 fx30  = clamp((fx_l + delta_l - Cx) / (2.0 * delta_l), 0.0, 1.0);
  vec4 fx60  = clamp((fx_u + delta_u - Cy) / (2.0 * delta_u), 0.0, 1.0);

  vec4 wd1 = wd(e, c, g, i, h5, f4, h, f);
  vec4 wd2 = wd(h, d, i5, f, i4, b, e, i);

  edri  = step(wd1, wd2) * irlv0;
  edr   = step(wd1 + vec4(0.1, 0.1, 0.1, 0.1), wd2) * step(vec4(0.5, 0.5, 0.5, 0.5), irlv1);
  edr_l = step(lv2_cf * df(f, g), df(h, c)) * irlv2l * edr;
  edr_u = step(lv2_cf * df(h, c), df(f, g)) * irlv2u * edr;

  fx45  = edr * fx45;
  fx30  = edr_l * fx30;
  fx60  = edr_u * fx60;
  fx45i = edri * fx45i;

  px = step(df(e, f), df(e, h));

  // SMOOTH_TIPS
  vec4 maximos = max(max(fx30, fx60), max(fx45, fx45i));

  vec3 res1 = E;
  res1 = mix(res1, mix(H, F, px.x), maximos.x);
  res1 = mix(res1, mix(B, D, px.z), maximos.z);

  vec3 res2 = E;
  res2 = mix(res2, mix(F, B, px.y), maximos.y);
  res2 = mix(res2, mix(D, H, px.w), maximos.w);

  vec3 res = mix(res1, res2, step(c_df(E, res1), c_df(E, res2)));

  FragColor = vec4(res, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`xBR shader: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

export class XbrRenderer {
  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly scale: WebGLUniformLocation,
  ) {}

  // null when the browser has no WebGL2.
  static create(canvas: HTMLCanvasElement): XbrRenderer | null {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) return null;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`xBR program: ${gl.getProgramInfoLog(program)}`);
    gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, "TextureSize"), WIDTH, HEIGHT);
    gl.uniform1i(gl.getUniformLocation(program, "decal"), 0);
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, WIDTH, HEIGHT);
    return new XbrRenderer(gl, gl.getUniformLocation(program, "XBR_SCALE")!);
  }

  // Draws one RGBA frame of WIDTH x HEIGHT at the canvas's current size.
  draw(pixels: Uint8ClampedArray): void {
    const gl = this.gl;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this.scale, gl.drawingBufferWidth / WIDTH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
