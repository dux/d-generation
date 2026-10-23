(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=class{#e=null;#t=new Map;#n=null;#r=null;get track(){return this.#r}async play(e){this.#i(),this.#r=e;let n=this.#e??=new AudioContext,r=this.#t.get(e);r||this.#t.set(e,r=t(n,e));let i=await r;if(this.#r!==e||this.#n)return;let a=new AudioBufferSourceNode(n,{buffer:i,loop:!0});a.connect(n.destination),a.start(),this.#n=a}stop(){this.#r=null,this.#i()}resume(){this.#e?.resume()}#i(){this.#n?.stop(),this.#n?.disconnect(),this.#n=null}};async function t(e,t){let n=await fetch(`assets/music/${t}.ogg`);if(!n.ok)throw Error(`Failed to load ${t}.ogg: ${n.status}`);return e.decodeAudioData(await n.arrayBuffer())}var n=3546895,r=[[1,0,1,407],[2,29,1,407],[3,1,1,407],[4,2,1,135],[5,3,1,204],[6,3,1,270],[9,4,1,407],[10,5,1,407],[7,2,1,204],[8,2,1,270],[12,2,1,407],[13,6,1,407],[14,7,1,407],[17,8,1,204],[57,8,1,241],[16,9,1,407],[58,8,1,181],[18,10,1,181],[23,11,1,813],[22,12,1,407],[20,13,1,204],[37,14,1,407],[25,4,1,407],[28,16,1,407],[29,8,1,270],[15,17,1,407],[59,18,1,407],[11,19,1,407],[26,8,1,135],[32,20,1,407],[33,21,0,204],[19,12,1,813],[24,22,1,204],[34,23,1,204],[27,24,1,813],[36,2,1,204],[21,27,1,813],[48,26,0,539],[51,11,1,721]].map(([e,t,n,r])=>({id:e,sample:t,oneShot:n!==0,period:r,volume:e===23?31:63}));function i(e){return`assets/sounds/sample${String(e).padStart(2,`0`)}.wav`}function a(e){let t=new DataView(e.buffer,e.byteOffset,e.byteLength),n=t=>String.fromCharCode(...e.subarray(t,t+4));if(n(0)!==`RIFF`||n(8)!==`WAVE`)throw Error(`not a WAVE file`);let r=null;for(let i=12;i+8<=e.length;){let a=n(i),o=t.getUint32(i+4,!0),s=i+8;if(a===`fmt `)r={channels:t.getUint16(s+2,!0),bits:t.getUint16(s+14,!0)};else if(a===`data`){if(!r||r.channels!==1||r.bits!==8)throw Error(`expected 8-bit mono PCM`);return{data:Int8Array.from(e.subarray(s,s+o),e=>e-128)}}i=s+o+(o&1)}throw Error(`WAVE file without data`)}async function o(e){return Promise.all(Array.from({length:30},async(t,n)=>a(await e(i(n)))))}var s=4,c=[-1,1,1,-1],l=.5,u=class{samples;music;muted;#e=null;#t=null;#n=new Map;#r=Array(s).fill(null);#i=!1;#a=0;#o=null;constructor(e,t,n){this.samples=e,this.music=t,this.muted=n}unlock(){this.#e||(this.#e=new AudioContext,this.#t=new GainNode(this.#e,{gain:l}),this.#t.connect(this.#e.destination)),this.#e.resume(),this.music.resume()}setMuted(e){this.muted=e,e&&this.stopAll(),this.applyMusic()}cue(e){e!==this.#o&&(this.#o=e,this.applyMusic())}play(e){if(this.#a===22&&e===57){this.#a=e;return}let t=63;if(e===23&&(this.#i=!this.#i,this.#i&&(e=51),t=31),this.#a=e,e===0)return this.stopAll();let n=r.find(t=>t.id===e);if(!n||this.muted||!this.#e||this.#e.state!==`running`)return;let i=this.#r.indexOf(null);if(i<0)return;let a=this.#e,o=new AudioBufferSourceNode(a,{buffer:this.buffer(n),loop:!n.oneShot});o.connect(new GainNode(a,{gain:t/64})).connect(new StereoPannerNode(a,{pan:c[i]})).connect(this.#t),o.onended=()=>{this.#r[i]===o&&(this.#r[i]=null)},this.#r[i]=o,o.start()}stopAll(){for(let[e,t]of this.#r.entries())t?.stop(),this.#r[e]=null}applyMusic(){this.muted||!this.#o?this.music.stop():this.music.track!==this.#o&&this.music.play(this.#o)}buffer(e){let t=this.#n.get(e);if(t)return t;let{data:r}=this.samples[e.sample];t=new AudioBuffer({length:r.length,sampleRate:n/e.period,numberOfChannels:1});let i=t.getChannelData(0);for(let e=0;e<r.length;e++)i[e]=r[e]/128;return this.#n.set(e,t),t}},d=`modulepreload`,f=function(e,t){return new URL(e,t).href},p={},m=function(e){return e.pathname.endsWith(`.css`)},h=function(e,t,n){if(t in e)return e[t];let r=n();if(!r){e[t]=void 0;return}let i=r.then(()=>{e[t]=void 0},n=>{throw e[t]=void 0,n});return e[t]=i,i},g=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=function(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))},i=function(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)},a,o=document.querySelector(`meta[property=csp-nonce]`),s=o?.nonce||o?.getAttribute(`nonce`);r=e(t.map(e=>{e=f(e,n);let t=i(e),r=m(t);return h(p,t.href,()=>{if(a===void 0){a={all:new Set,styles:new Set};let e=document.getElementsByTagName(`link`);for(let t=e.length-1;t>=0;t--){let n=e[t];a.all.add(n.href),n.rel===`stylesheet`&&a.styles.add(n.href)}}if((r?a.styles:a.all).has(t.href))return;let e=document.createElement(`link`);if(e.rel=r?`stylesheet`:d,r||(e.as=`script`),e.crossOrigin=``,e.href=t.href,s&&e.setAttribute(`nonce`,s),document.head.appendChild(e),r)return new Promise((n,r)=>{e.addEventListener(`load`,n),e.addEventListener(`error`,()=>r(Error(`Unable to preload CSS for ${t}`)))})})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},_=Object.assign({"../../../levels/floor01.json5":()=>g(()=>import(`./floor01-CInOzTaY.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor02.json5":()=>g(()=>import(`./floor02-B6JetEVO.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor03.json5":()=>g(()=>import(`./floor03-BwKKduoK.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor04.json5":()=>g(()=>import(`./floor04-BqIhRYaF.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor05.json5":()=>g(()=>import(`./floor05-CKcWyniN.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor06.json5":()=>g(()=>import(`./floor06-quBow66s.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor07.json5":()=>g(()=>import(`./floor07-CHRqaQ-J.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor08.json5":()=>g(()=>import(`./floor08-ytDMmezC.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor09.json5":()=>g(()=>import(`./floor09-B4ZuKgr2.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor10.json5":()=>g(()=>import(`./floor10-nYU2xFdh.js`).then(e=>e.default),[],import.meta.url)});function v(e){return async t=>{let n=_[`../../../${t}`];if(n)return new TextEncoder().encode(await n());let r=await fetch(new URL(t,e));if(!r.ok)throw Error(`${t}: HTTP ${r.status}`);return new Uint8Array(await r.arrayBuffer())}}var ee=256e3,y={Backquote:0,Digit1:1,Digit2:2,Digit3:3,Digit4:4,Digit5:5,Digit6:6,Digit7:7,Digit8:8,Digit9:9,Digit0:10,Minus:11,Equal:12,Backslash:13,Numpad0:15,KeyQ:16,KeyW:17,KeyE:18,KeyR:19,KeyT:20,KeyY:21,KeyU:22,KeyI:23,KeyO:24,KeyP:25,BracketLeft:26,BracketRight:27,Numpad1:29,Numpad2:30,Numpad3:31,KeyA:32,KeyS:33,KeyD:34,KeyF:35,KeyG:36,KeyH:37,KeyJ:38,KeyK:39,KeyL:40,Semicolon:41,Quote:42,Numpad4:45,Numpad5:46,Numpad6:47,IntlBackslash:48,KeyZ:49,KeyX:50,KeyC:51,KeyV:52,KeyB:53,KeyN:54,KeyM:55,Comma:56,Period:57,Slash:58,NumpadDecimal:60,Numpad7:61,Numpad8:62,Numpad9:63,Space:64,Backspace:65,Tab:66,NumpadEnter:67,Enter:68,Escape:69,Delete:70,NumpadSubtract:74,F1:80,F2:81,F3:82,F4:83,F5:84,F6:85,F7:86,F8:87,F9:88,F10:89,NumpadDivide:92,NumpadMultiply:93,NumpadAdd:94,Help:95,Insert:95,ShiftLeft:96,ShiftRight:97,CapsLock:98,ControlLeft:99,ControlRight:99,AltLeft:100,AltRight:101},b={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]},x=[[61,76,63],[79,0,78],[29,77,31]],S=1<<28,C=1,w=2,T=4,E=8,D=1<<23,O=1<<22,te=class{send;hotkeys;onKey;arrows=new Set;arrowKey=0;listener=e=>this.key(e);constructor(e,t,n){this.send=e,this.hotkeys=t,this.onKey=n,window.addEventListener(`keydown`,this.listener),window.addEventListener(`keyup`,this.listener)}dispose(){window.removeEventListener(`keydown`,this.listener),window.removeEventListener(`keyup`,this.listener)}key(e){if(e.metaKey)return;let t=e.type===`keydown`;t&&this.onKey();let n=this.hotkeys[e.code];if(n){e.preventDefault(),t&&!e.repeat&&n();return}if(b[e.code]){e.preventDefault(),t?this.arrows.add(e.code):this.arrows.delete(e.code);let n=0,r=0;for(let e of this.arrows)[n,r]=[n+b[e][0],r+b[e][1]];let i=x[r+1][n+1];if(i===this.arrowKey)return;this.arrowKey&&this.send(this.arrowKey|128),i&&this.send(i),this.arrowKey=i;return}let r=y[e.code],i=e.key===`Enter`?13:e.key===`Backspace`?8:e.key.length===1?e.key.charCodeAt(0):0;(r!==void 0||i)&&(e.preventDefault(),t&&i&&i<128&&this.send(256|i),r!==void 0&&this.send(t?r:r|128))}};function k(){let e=navigator.getGamepads?.().find(e=>e?.connected);if(!e)return S;let t=t=>!!e.buttons[t]?.pressed,[n=0,r=0]=e.axes,i=S;return(n>.5||t(15))&&(i|=C),(n<-.5||t(14))&&(i|=w),(r>.5||t(13))&&(i|=T),(r<-.5||t(12))&&(i|=E),t(0)&&(i|=D),t(1)&&(i|=O),i>>>0}var A=`#version 300 es
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
`,j=`#version 300 es
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
`;function M(e,t,n){let r=e.createShader(t);if(e.shaderSource(r,n),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS))throw Error(`xBR shader: ${e.getShaderInfoLog(r)}`);return r}var ne=class e{gl;scale;constructor(e,t){this.gl=e,this.scale=t}static create(t){let n=t.getContext(`webgl2`,{alpha:!1,antialias:!1,depth:!1,stencil:!1});if(!n)return null;let r=n.createProgram();if(n.attachShader(r,M(n,n.VERTEX_SHADER,A)),n.attachShader(r,M(n,n.FRAGMENT_SHADER,j)),n.linkProgram(r),!n.getProgramParameter(r,n.LINK_STATUS))throw Error(`xBR program: ${n.getProgramInfoLog(r)}`);return n.useProgram(r),n.uniform2f(n.getUniformLocation(r,`TextureSize`),320,200),n.uniform1i(n.getUniformLocation(r,`decal`),0),n.bindVertexArray(n.createVertexArray()),n.bindTexture(n.TEXTURE_2D,n.createTexture()),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE),n.texStorage2D(n.TEXTURE_2D,1,n.RGBA8,320,200),new e(n,n.getUniformLocation(r,`XBR_SCALE`))}draw(e){let t=this.gl;t.texSubImage2D(t.TEXTURE_2D,0,0,0,320,200,t.RGBA,t.UNSIGNED_BYTE,e),t.viewport(0,0,t.drawingBufferWidth,t.drawingBufferHeight),t.uniform1f(this.scale,t.drawingBufferWidth/320),t.drawArrays(t.TRIANGLES,0,3)}},N=`d-generation-aga-nv:`,P=`d-generation-aga`,F=`snapshots`,I=`f5`;function re(){let e=[];for(let t=0;t<localStorage.length;t++){let n=localStorage.key(t);n.startsWith(N)&&e.push([n.slice(20),Uint8Array.from(atob(localStorage.getItem(n)),e=>e.charCodeAt(0))])}return e}function ie(e,t){t?localStorage.setItem(N+e,btoa(String.fromCharCode(...t))):localStorage.removeItem(N+e)}function ae(){let{promise:e,resolve:t,reject:n}=Promise.withResolvers(),r=indexedDB.open(P,1);return r.onupgradeneeded=()=>r.result.createObjectStore(F),r.onsuccess=()=>t(r.result),r.onerror=()=>n(r.error),e}function L(e,t,n){let{promise:r,resolve:i,reject:a}=Promise.withResolvers(),o=e.transaction(F,t),s=n(o.objectStore(F));return o.oncomplete=()=>i(s.result),o.onabort=()=>a(o.error??s.error),r}async function R(e){if(!crossOriginIsolated)throw Error(`the page needs cross-origin isolation (COOP/COEP headers) for SharedArrayBuffer`);let{canvas:t,box:n,audio:r,onStatus:i}=e,a=`${e.demo?`Title`:`New game`} - arrows/keypad move, Esc pause, F5 save state, F9 restore state`,o=new SharedArrayBuffer(1052),s=new SharedArrayBuffer(ee),c=new Int32Array(o);Atomics.store(c,5,k());let l=new OffscreenCanvas(320,200),u=l.getContext(`2d`),d=u.createImageData(320,200),f=t.getContext(`2d`),p=new Uint8ClampedArray(s),m=null,h=null,g=!1,_=()=>{if(g)return h.draw(d.data);u.putImageData(d,0,0),f.drawImage(l,0,0,t.width,t.height)},v=()=>{let e=devicePixelRatio,r=Math.min(n.clientWidth*e/320,n.clientHeight*e/200),i=g?m:t,a=Math.max(1,Math.ceil(r)),o=g?Math.max(1,Math.round(320*r)):320*a,s=g?Math.max(1,Math.round(200*r)):200*a;(i.width!==o||i.height!==s)&&(i.width=o,i.height=s,f.imageSmoothingEnabled=!1),i.style.width=`${(g?o:320*r)/e}px`,i.style.height=`${(g?s:200*r)/e}px`,i.style.margin=`0`;let{left:c,top:l}=i.getBoundingClientRect();i.style.marginLeft=`${(Math.ceil(c*e)-c*e)/e}px`,i.style.marginTop=`${(Math.ceil(l*e)-l*e)/e}px`,_()},y=e=>{if(e&&!h){if(m=document.createElement(`canvas`),h=ne.create(m),!h)return!1;m.hidden=!0,t.after(m)}return g=e,t.hidden=e,m&&(m.hidden=!e),v(),!0},b=new ResizeObserver(v);b.observe(n);let x=matchMedia(`(resolution: ${devicePixelRatio}dppx)`),S=()=>{x.removeEventListener(`change`,S),x=matchMedia(`(resolution: ${devicePixelRatio}dppx)`),x.addEventListener(`change`,S),v()};x.addEventListener(`change`,S),v();let C=new Worker(new URL(new URL(`worker-uL4lnLLw.js`,import.meta.url).href,``+import.meta.url),{type:`module`}),w=e=>C.postMessage(e),T=!1,E=0,D=null,O=()=>{T||(T=!0,cancelAnimationFrame(E),C.terminate(),b.disconnect(),x.removeEventListener(`change`,S),D?.dispose(),r.stopAll(),r.cue(null),m?.remove(),t.hidden=!1)},A=t=>{T||(O(),e.onStop(t))},j=``,M=(e=``)=>i(`${a}  |  ${j}${e?`  |  ${e}`:``}`),N=ae(),P=async e=>{await L(await N,`readwrite`,t=>t.put(e,I)),M(`state saved`)},F=async()=>{let e=await L(await N,`readonly`,e=>e.get(I));if(!e)return M(`no saved state yet`);Atomics.load(c,4)||(w({type:`restore`,snapshot:e}),Atomics.store(c,4,1))};C.onmessage=({data:e})=>{switch(e.type){case`running`:M();break;case`sounds`:for(let t of e.ids)r.play(t);break;case`music`:r.cue(e.track);break;case`scene`:j=e.screen?`title/story screen`:`scene ${e.scene}`,M();break;case`nonvolatile`:ie(e.key,e.data);break;case`snapshot`:P(e.snapshot).catch(e=>M(`save failed: ${e}`));break;case`restored`:M(`state restored`);break;case`quit`:O(),i(`The game quit (Ctrl+Q). Choose Title or New game to start again.`);break;case`error`:A(Error(e.message))}},C.onerror=e=>A(Error(e.message||`game worker failed to start`));let R=()=>Atomics.store(c,3,1),z=()=>F().catch(e=>M(`restore failed: ${e}`));D=new te(e=>{let t=Atomics.load(c,0);t-Atomics.load(c,1)>=256||(c[7+t%256]=e,Atomics.store(c,0,t+1))},{F5:R,F9:()=>void z()},()=>r.unlock()),i(`Loading...`),w({type:`start`,demo:e.demo,base:document.baseURI,control:o,frame:s,nonvolatile:re()});let B=0,V=()=>{Atomics.store(c,5,k());let e=Atomics.load(c,6);e!==B&&(B=e,d.data.set(p),_()),E=requestAnimationFrame(V)};return E=requestAnimationFrame(V),{stop:O,save:R,restore:()=>void z(),setEnhanced:y}}var z=`d-generation-aga-sound`,B=`d-generation-aga-enhanced`,V=e=>document.getElementById(e),H=V(`save`),U=V(`restore`),W=V(`enhanced`),G=V(`sound`),K=V(`stopped`),q=V(`status`),J=localStorage.getItem(z)!==`off`;G.textContent=`Sound: ${J?`on`:`off`}`;var Y=localStorage.getItem(B)===`on`,X=null,Z=null;function oe(e){console.error(e),K.textContent=`Game stopped: ${e instanceof Error?e.message:String(e)}`,K.hidden=!1}function Q(){X&&!X.setEnhanced(Y)&&(W.hidden=!0),W.textContent=`Enhanced: ${Y?`on`:`off`}`}H.addEventListener(`click`,()=>{H.blur(),X?.save()}),U.addEventListener(`click`,()=>{U.blur(),X?.restore()}),G.addEventListener(`click`,()=>{G.blur(),J=!J,localStorage.setItem(z,J?`on`:`off`),G.textContent=`Sound: ${J?`on`:`off`}`,Z?.setMuted(!J),Z?.unlock()}),W.addEventListener(`click`,()=>{W.blur(),Y=!Y,localStorage.setItem(B,Y?`on`:`off`),Q()}),Q();var $=`d-generation-isolation-reload`;crossOriginIsolated?sessionStorage.removeItem($):`serviceWorker`in navigator&&isSecureContext&&!sessionStorage.getItem($)&&(sessionStorage.setItem($,`1`),q.textContent=`Enabling cross-origin isolation...`,await navigator.serviceWorker.register(`coi-sw.js`),await navigator.serviceWorker.ready,location.reload(),await new Promise(()=>{}));try{q.textContent=`Loading...`,Z=new u(await o(v(document.baseURI)),new e,!J),X=await R({canvas:V(`game`),box:V(`box`),audio:Z,demo:!0,onStatus:e=>q.textContent=e,onStop:e=>{X=null,oe(e)}}),Q()}catch(e){q.textContent=``,oe(e)}