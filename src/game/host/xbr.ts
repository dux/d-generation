import { HEIGHT, WIDTH } from "./shared.ts";

// The Enhanced view: each 320x200 frame is magnified to 640x400 with Hyllian's xBR-lv2-noblend (libretro
// glsl-shaders xbr/shaders/xbr-lv2-noblend.glsl, default parameters, ported to GLSL ES 3.00), which follows
// 1:1 and 2:1 edges and only ever picks one of the neighbouring colours: twice the pixel density, no blur, no
// new colours. The 640x400 picture is then copied to the canvas at a whole multiple with nearest sampling, like
// the plain view does with 320x200.

/*
   Hyllian's xBR-lv2-noblend Shader

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

export const ENHANCED_WIDTH = WIDTH * 2;
export const ENHANCED_HEIGHT = HEIGHT * 2;

// One triangle covering the target; frame row 0 at the top.
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

// CORNER_A, the shader's default corner detection.
const FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 TextureSize;
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

const float lv2_cf = 2.0;
const vec3 Y = vec3(0.2126, 0.7152, 0.0722);

// Difference between vector components.
vec4 df(vec4 A, vec4 B) {
  return vec4(abs(A - B));
}

// Compare two vectors and return their components are different.
vec4 diff(vec4 A, vec4 B) {
  return vec4(notEqual(A, B));
}

// Weighted distance.
vec4 wd(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 f, vec4 g, vec4 h) {
  return df(a, b) + df(a, c) + df(d, e) + df(d, f) + 4.0 * df(g, h);
}

void main() {
  vec4 edr, edr_l, edr_u; // edr = edge detection rule
  vec4 irlv1, irlv2l, irlv2u;
  bvec4 nc, px;
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

  vec4 b = Y * mat4x3(B, D, H, F);
  vec4 c = Y * mat4x3(C, A, G, I);
  vec4 e = Y * mat4x3(E, E, E, E);
  vec4 d = b.yzwx;
  vec4 f = b.wxyz;
  vec4 g = c.zwxy;
  vec4 h = b.zwxy;
  vec4 i = c.wxyz;

  vec4 i4 = Y * mat4x3(I4, C1, A0, G5);
  vec4 i5 = Y * mat4x3(I5, C4, A1, G0);
  vec4 h5 = Y * mat4x3(H5, F4, B1, D0);
  vec4 f4 = h5.yzwx;

  vec4 Ao = vec4(1.0, -1.0, -1.0, 1.0);
  vec4 Bo = vec4(1.0, 1.0, -1.0, -1.0);
  vec4 Co = vec4(1.5, 0.5, -0.5, 0.5);
  vec4 Ax = vec4(1.0, -1.0, -1.0, 1.0);
  vec4 Bx = vec4(0.5, 2.0, -0.5, -2.0);
  vec4 Cx = vec4(1.0, 1.0, -0.5, 0.0);
  vec4 Ay = vec4(1.0, -1.0, -1.0, 1.0);
  vec4 By = vec4(2.0, 0.5, -2.0, -0.5);
  vec4 Cy = vec4(2.0, 0.0, -1.0, 0.5);

  // These inequations define the line below which interpolation occurs.
  fx   = vec4(greaterThan(Ao * fp.y + Bo * fp.x, Co));
  fx_l = vec4(greaterThan(Ax * fp.y + Bx * fp.x, Cx));
  fx_u = vec4(greaterThan(Ay * fp.y + By * fp.x, Cy));

  irlv1 = diff(e, f) * diff(e, h);

  irlv2l = diff(e, g) * diff(d, g);
  irlv2u = diff(e, c) * diff(b, c);

  vec4 wd1 = wd(e, c, g, i, h5, f4, h, f);
  vec4 wd2 = wd(h, d, i5, f, i4, b, e, i);

  edr   = step(wd1 + vec4(0.1, 0.1, 0.1, 0.1), wd2) * step(vec4(0.5, 0.5, 0.5, 0.5), irlv1);
  edr_l = step(lv2_cf * df(f, g), df(h, c)) * irlv2l * edr;
  edr_u = step(lv2_cf * df(h, c), df(f, g)) * irlv2u * edr;

  nc = bvec4(edr * (fx + edr_l * fx_l) + edr_u * fx_u);

  px = lessThanEqual(df(e, f), df(e, h));

  vec3 res1 = nc.x ? px.x ? F : H : nc.y ? px.y ? B : F : nc.z ? px.z ? D : B : E;
  vec3 res2 = nc.w ? px.w ? H : D : nc.z ? px.z ? D : B : nc.y ? px.y ? B : F : E;

  vec2 df12 = abs(Y * mat2x3(res1, res2) - e.xy);

  vec3 res = mix(res1, res2, step(df12.x, df12.y));

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

function texture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
  return texture;
}

export class XbrRenderer {
  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly frame: WebGLTexture,
    private readonly magnified: WebGLFramebuffer,
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
    const magnified = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, magnified);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture(gl, ENHANCED_WIDTH, ENHANCED_HEIGHT), 0);
    const frame = texture(gl, WIDTH, HEIGHT);
    return new XbrRenderer(gl, frame, magnified);
  }

  // Magnifies one RGBA frame of WIDTH x HEIGHT and copies it over the whole canvas.
  draw(pixels: Uint8ClampedArray): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.frame);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.magnified);
    gl.viewport(0, 0, ENHANCED_WIDTH, ENHANCED_HEIGHT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.magnified);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
    gl.blitFramebuffer(0, 0, ENHANCED_WIDTH, ENHANCED_HEIGHT, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
}
