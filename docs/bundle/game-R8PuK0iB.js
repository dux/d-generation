(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=class{#e=null;#t=new Map;#n=null;#r=null;get track(){return this.#r}async play(e){this.#i(),this.#r=e;let n=this.#e??=new AudioContext,r=this.#t.get(e);r||this.#t.set(e,r=t(n,e));let i=await r;if(this.#r!==e||this.#n)return;let a=new AudioBufferSourceNode(n,{buffer:i,loop:!0});a.connect(n.destination),a.start(),this.#n=a}stop(){this.#r=null,this.#i()}resume(){this.#e?.resume()}#i(){this.#n?.stop(),this.#n?.disconnect(),this.#n=null}};async function t(e,t){let n=await fetch(`assets/music/${t}.ogg`);if(!n.ok)throw Error(`Failed to load ${t}.ogg: ${n.status}`);return e.decodeAudioData(await n.arrayBuffer())}var n=3546895,r=[[1,0,1,407],[2,29,1,407],[3,1,1,407],[4,2,1,135],[5,3,1,204],[6,3,1,270],[9,4,1,407],[10,5,1,407],[7,2,1,204],[8,2,1,270],[12,2,1,407],[13,6,1,407],[14,7,1,407],[17,8,1,204],[57,8,1,241],[16,9,1,407],[58,8,1,181],[18,10,1,181],[23,11,1,813],[22,12,1,407],[20,13,1,204],[37,14,1,407],[25,4,1,407],[28,16,1,407],[29,8,1,270],[15,17,1,407],[59,18,1,407],[11,19,1,407],[26,8,1,135],[32,20,1,407],[33,21,0,204],[19,12,1,813],[24,22,1,204],[34,23,1,204],[27,24,1,813],[36,2,1,204],[21,27,1,813],[48,26,0,539],[51,11,1,721]].map(([e,t,n,r])=>({id:e,sample:t,oneShot:n!==0,period:r,volume:e===23?31:63}));function i(e){return`assets/sounds/sample${String(e).padStart(2,`0`)}.wav`}function a(e){let t=new DataView(e.buffer,e.byteOffset,e.byteLength),n=t=>String.fromCharCode(...e.subarray(t,t+4));if(n(0)!==`RIFF`||n(8)!==`WAVE`)throw Error(`not a WAVE file`);let r=null;for(let i=12;i+8<=e.length;){let a=n(i),o=t.getUint32(i+4,!0),s=i+8;if(a===`fmt `)r={channels:t.getUint16(s+2,!0),bits:t.getUint16(s+14,!0)};else if(a===`data`){if(!r||r.channels!==1||r.bits!==8)throw Error(`expected 8-bit mono PCM`);return{data:Int8Array.from(e.subarray(s,s+o),e=>e-128)}}i=s+o+(o&1)}throw Error(`WAVE file without data`)}async function o(e){return Promise.all(Array.from({length:30},async(t,n)=>a(await e(i(n)))))}var s=4,c=[-1,1,1,-1],l=.5,u=class{samples;music;muted;#e=null;#t=null;#n=new Map;#r=Array(s).fill(null);#i=!1;#a=0;#o=null;constructor(e,t,n){this.samples=e,this.music=t,this.muted=n}unlock(){this.#e||(this.#e=new AudioContext,this.#t=new GainNode(this.#e,{gain:l}),this.#t.connect(this.#e.destination)),this.#e.resume(),this.music.resume()}setMuted(e){this.muted=e,e&&this.stopAll(),this.applyMusic()}cue(e){e!==this.#o&&(this.#o=e,this.applyMusic())}play(e){if(this.#a===22&&e===57){this.#a=e;return}let t=63;if(e===23&&(this.#i=!this.#i,this.#i&&(e=51),t=31),this.#a=e,e===0)return this.stopAll();let n=r.find(t=>t.id===e);if(!n||this.muted||!this.#e||this.#e.state!==`running`)return;let i=this.#r.indexOf(null);if(i<0)return;let a=this.#e,o=new AudioBufferSourceNode(a,{buffer:this.buffer(n),loop:!n.oneShot});o.connect(new GainNode(a,{gain:t/64})).connect(new StereoPannerNode(a,{pan:c[i]})).connect(this.#t),o.onended=()=>{this.#r[i]===o&&(this.#r[i]=null)},this.#r[i]=o,o.start()}stopAll(){for(let[e,t]of this.#r.entries())t?.stop(),this.#r[e]=null}applyMusic(){this.muted||!this.#o?this.music.stop():this.music.track!==this.#o&&this.music.play(this.#o)}buffer(e){let t=this.#n.get(e);if(t)return t;let{data:r}=this.samples[e.sample];t=new AudioBuffer({length:r.length,sampleRate:n/e.period,numberOfChannels:1});let i=t.getChannelData(0);for(let e=0;e<r.length;e++)i[e]=r[e]/128;return this.#n.set(e,t),t}},d=`modulepreload`,f=function(e,t){return new URL(e,t).href},p={},m=function(e){return e.pathname.endsWith(`.css`)},h=function(e,t,n){if(t in e)return e[t];let r=n();if(!r){e[t]=void 0;return}let i=r.then(()=>{e[t]=void 0},n=>{throw e[t]=void 0,n});return e[t]=i,i},g=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=function(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))},i=function(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)},a,o=document.querySelector(`meta[property=csp-nonce]`),s=o?.nonce||o?.getAttribute(`nonce`);r=e(t.map(e=>{e=f(e,n);let t=i(e),r=m(t);return h(p,t.href,()=>{if(a===void 0){a={all:new Set,styles:new Set};let e=document.getElementsByTagName(`link`);for(let t=e.length-1;t>=0;t--){let n=e[t];a.all.add(n.href),n.rel===`stylesheet`&&a.styles.add(n.href)}}if((r?a.styles:a.all).has(t.href))return;let e=document.createElement(`link`);if(e.rel=r?`stylesheet`:d,r||(e.as=`script`),e.crossOrigin=``,e.href=t.href,s&&e.setAttribute(`nonce`,s),document.head.appendChild(e),r)return new Promise((n,r)=>{e.addEventListener(`load`,n),e.addEventListener(`error`,()=>r(Error(`Unable to preload CSS for ${t}`)))})})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},_=Object.assign({"../../../levels/floor01.json5":()=>g(()=>import(`./floor01-CInOzTaY.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor02.json5":()=>g(()=>import(`./floor02-B6JetEVO.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor03.json5":()=>g(()=>import(`./floor03-BwKKduoK.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor04.json5":()=>g(()=>import(`./floor04-BqIhRYaF.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor05.json5":()=>g(()=>import(`./floor05-CKcWyniN.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor06.json5":()=>g(()=>import(`./floor06-quBow66s.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor07.json5":()=>g(()=>import(`./floor07-CHRqaQ-J.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor08.json5":()=>g(()=>import(`./floor08-ytDMmezC.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor09.json5":()=>g(()=>import(`./floor09-B4ZuKgr2.js`).then(e=>e.default),[],import.meta.url),"../../../levels/floor10.json5":()=>g(()=>import(`./floor10-nYU2xFdh.js`).then(e=>e.default),[],import.meta.url)});function ee(e){return async t=>{let n=_[`../../../${t}`];if(n)return new TextEncoder().encode(await n());let r=await fetch(new URL(t,e));if(!r.ok)throw Error(`${t}: HTTP ${r.status}`);return new Uint8Array(await r.arrayBuffer())}}var te=256e3,v={Backquote:0,Digit1:1,Digit2:2,Digit3:3,Digit4:4,Digit5:5,Digit6:6,Digit7:7,Digit8:8,Digit9:9,Digit0:10,Minus:11,Equal:12,Backslash:13,Numpad0:15,KeyQ:16,KeyW:17,KeyE:18,KeyR:19,KeyT:20,KeyY:21,KeyU:22,KeyI:23,KeyO:24,KeyP:25,BracketLeft:26,BracketRight:27,Numpad1:29,Numpad2:30,Numpad3:31,KeyA:32,KeyS:33,KeyD:34,KeyF:35,KeyG:36,KeyH:37,KeyJ:38,KeyK:39,KeyL:40,Semicolon:41,Quote:42,Numpad4:45,Numpad5:46,Numpad6:47,IntlBackslash:48,KeyZ:49,KeyX:50,KeyC:51,KeyV:52,KeyB:53,KeyN:54,KeyM:55,Comma:56,Period:57,Slash:58,NumpadDecimal:60,Numpad7:61,Numpad8:62,Numpad9:63,Space:64,Backspace:65,Tab:66,NumpadEnter:67,Enter:68,Escape:69,Delete:70,NumpadSubtract:74,F1:80,F2:81,F3:82,F4:83,F5:84,F6:85,F7:86,F8:87,F9:88,F10:89,NumpadDivide:92,NumpadMultiply:93,NumpadAdd:94,Help:95,Insert:95,ShiftLeft:96,ShiftRight:97,CapsLock:98,ControlLeft:99,ControlRight:99,AltLeft:100,AltRight:101},y={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]},b=[[61,76,63],[79,0,78],[29,77,31]],x=1<<28,S=1,C=2,w=4,T=8,E=1<<23,D=1<<22,ne=class{send;hotkeys;onKey;arrows=new Set;arrowKey=0;listener=e=>this.key(e);constructor(e,t,n){this.send=e,this.hotkeys=t,this.onKey=n,window.addEventListener(`keydown`,this.listener),window.addEventListener(`keyup`,this.listener)}dispose(){window.removeEventListener(`keydown`,this.listener),window.removeEventListener(`keyup`,this.listener)}key(e){if(e.metaKey)return;let t=e.type===`keydown`;t&&this.onKey();let n=this.hotkeys[e.code];if(n){e.preventDefault(),t&&!e.repeat&&n();return}if(y[e.code]){e.preventDefault(),t?this.arrows.add(e.code):this.arrows.delete(e.code);let n=0,r=0;for(let e of this.arrows)[n,r]=[n+y[e][0],r+y[e][1]];let i=b[r+1][n+1];if(i===this.arrowKey)return;this.arrowKey&&this.send(this.arrowKey|128),i&&this.send(i),this.arrowKey=i;return}let r=v[e.code],i=e.key===`Enter`?13:e.key===`Backspace`?8:e.key.length===1?e.key.charCodeAt(0):0;(r!==void 0||i)&&(e.preventDefault(),t&&i&&i<128&&this.send(256|i),r!==void 0&&this.send(t?r:r|128))}};function re(){let e=navigator.getGamepads?.().find(e=>e?.connected);if(!e)return x;let t=t=>!!e.buttons[t]?.pressed,[n=0,r=0]=e.axes,i=x;return(n>.5||t(15))&&(i|=S),(n<-.5||t(14))&&(i|=C),(r>.5||t(13))&&(i|=w),(r<-.5||t(12))&&(i|=T),t(0)&&(i|=E),t(1)&&(i|=D),i>>>0}var O=640,k=400,A=`#version 300 es
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
`;function M(e,t,n){let r=e.createShader(t);if(e.shaderSource(r,n),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS))throw Error(`xBR shader: ${e.getShaderInfoLog(r)}`);return r}function N(e,t,n){let r=e.createTexture();return e.bindTexture(e.TEXTURE_2D,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texStorage2D(e.TEXTURE_2D,1,e.RGBA8,t,n),r}var ie=class e{gl;frame;magnified;constructor(e,t,n){this.gl=e,this.frame=t,this.magnified=n}static create(t){let n=t.getContext(`webgl2`,{alpha:!1,antialias:!1,depth:!1,stencil:!1});if(!n)return null;let r=n.createProgram();if(n.attachShader(r,M(n,n.VERTEX_SHADER,A)),n.attachShader(r,M(n,n.FRAGMENT_SHADER,j)),n.linkProgram(r),!n.getProgramParameter(r,n.LINK_STATUS))throw Error(`xBR program: ${n.getProgramInfoLog(r)}`);n.useProgram(r),n.uniform2f(n.getUniformLocation(r,`TextureSize`),320,200),n.uniform1i(n.getUniformLocation(r,`decal`),0),n.bindVertexArray(n.createVertexArray());let i=n.createFramebuffer();n.bindFramebuffer(n.FRAMEBUFFER,i),n.framebufferTexture2D(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,N(n,O,k),0);let a=N(n,320,200);return new e(n,a,i)}draw(e){let t=this.gl;t.bindTexture(t.TEXTURE_2D,this.frame),t.texSubImage2D(t.TEXTURE_2D,0,0,0,320,200,t.RGBA,t.UNSIGNED_BYTE,e),t.bindFramebuffer(t.FRAMEBUFFER,this.magnified),t.viewport(0,0,O,k),t.drawArrays(t.TRIANGLES,0,3),t.bindFramebuffer(t.READ_FRAMEBUFFER,this.magnified),t.bindFramebuffer(t.DRAW_FRAMEBUFFER,null);let{drawingBufferWidth:n,drawingBufferHeight:r}=t;t.blitFramebuffer(0,0,O,k,0,0,n,r,t.COLOR_BUFFER_BIT,t.NEAREST)}},P=`d-generation-aga-nv:`,F=`d-generation-aga`,I=`snapshots`,ae=`f5`;function oe(){let e=[];for(let t=0;t<localStorage.length;t++){let n=localStorage.key(t);n.startsWith(P)&&e.push([n.slice(20),Uint8Array.from(atob(localStorage.getItem(n)),e=>e.charCodeAt(0))])}return e}function se(e,t){t?localStorage.setItem(P+e,btoa(String.fromCharCode(...t))):localStorage.removeItem(P+e)}function ce(){let{promise:e,resolve:t,reject:n}=Promise.withResolvers(),r=indexedDB.open(F,1);return r.onupgradeneeded=()=>r.result.createObjectStore(I),r.onsuccess=()=>t(r.result),r.onerror=()=>n(r.error),e}function le(e,t,n){let{promise:r,resolve:i,reject:a}=Promise.withResolvers(),o=e.transaction(I,t),s=n(o.objectStore(I));return o.oncomplete=()=>i(s.result),o.onabort=()=>a(o.error??s.error),r}async function L(e){if(!crossOriginIsolated)throw Error(`the page needs cross-origin isolation (COOP/COEP headers) for SharedArrayBuffer`);let{canvas:t,box:n,audio:r,onStatus:i}=e,a=new SharedArrayBuffer(1060),o=new SharedArrayBuffer(te),s=new Int32Array(a);Atomics.store(s,5,re());let c=new OffscreenCanvas(320,200),l=c.getContext(`2d`),u=l.createImageData(320,200),d=t.getContext(`2d`),f=new Uint8ClampedArray(o),p=null,m=null,h=!1,g=()=>{if(h)return m.draw(u.data);l.putImageData(u,0,0),d.drawImage(c,0,0,t.width,t.height)},_=()=>{let e=devicePixelRatio,r=h?p:t,i=h?O:320,a=h?k:200,o=Math.min(n.clientWidth*e/i,n.clientHeight*e/a),s=Math.max(1,Math.ceil(o));(r.width!==i*s||r.height!==a*s)&&(r.width=i*s,r.height=a*s,d.imageSmoothingEnabled=!1),r.style.width=`${i*o/e}px`,r.style.height=`${a*o/e}px`,r.style.margin=`0`;let{left:c,top:l}=r.getBoundingClientRect();r.style.marginLeft=`${(Math.ceil(c*e)-c*e)/e}px`,r.style.marginTop=`${(Math.ceil(l*e)-l*e)/e}px`,g()},ee=e=>{if(e&&!m){if(p=document.createElement(`canvas`),m=ie.create(p),!m)return!1;p.hidden=!0,t.after(p)}return h=e,t.hidden=e,p&&(p.hidden=!e),_(),!0},v=new ResizeObserver(_);v.observe(n);let y=matchMedia(`(resolution: ${devicePixelRatio}dppx)`),b=()=>{y.removeEventListener(`change`,b),y=matchMedia(`(resolution: ${devicePixelRatio}dppx)`),y.addEventListener(`change`,b),_()};y.addEventListener(`change`,b),_();let x=new Worker(new URL(new URL(`worker-BdTVp7gn.js`,import.meta.url).href,``+import.meta.url),{type:`module`}),S=e=>x.postMessage(e),C=!1,w=0,T=null,E=()=>{C||(C=!0,cancelAnimationFrame(w),x.terminate(),v.disconnect(),y.removeEventListener(`change`,b),T?.dispose(),r.stopAll(),r.cue(null),p?.remove(),t.hidden=!1)},D=t=>{C||(E(),e.onStop(t))},A=``,j=(e=``)=>i(`arrows move, Space laser, T grenade, U inventory, Enter talk, Esc pause, F5 save, F9 restore  |  ${A}${e?`  |  ${e}`:``}`),M=ce(),N=async e=>{await le(await M,`readwrite`,t=>t.put(e,ae)),j(`state saved`)},P=async()=>{let e=await le(await M,`readonly`,e=>e.get(ae));if(!e)return j(`no saved state yet`);Atomics.load(s,4)||(S({type:`restore`,snapshot:e}),Atomics.store(s,4,1))};x.onmessage=({data:e})=>{switch(e.type){case`running`:j();break;case`sounds`:for(let t of e.ids)r.play(t);break;case`music`:r.cue(e.track);break;case`scene`:A=e.screen?`title/story screen`:`scene ${e.scene}`,j();break;case`nonvolatile`:se(e.key,e.data);break;case`snapshot`:N(e.snapshot).catch(e=>j(`save failed: ${e}`));break;case`restored`:j(`state restored`);break;case`quit`:E(),i(`The game quit (Ctrl+Q). Choose Title or New game to start again.`);break;case`error`:D(Error(e.message))}},x.onerror=e=>D(Error(e.message||`game worker failed to start`));let F=()=>Atomics.store(s,3,1),I=()=>P().catch(e=>j(`restore failed: ${e}`)),L=e=>{let t=Atomics.load(s,0);t-Atomics.load(s,1)>=256||(s[9+t%256]=e,Atomics.store(s,0,t+1))};T=new ne(L,{F5:F,F9:()=>void I()},()=>r.unlock());let R=()=>{for(let e of[99,19,147,227])L(e);j(`level restarted`)};i(`Loading...`),S({type:`start`,demo:e.demo,base:document.baseURI,control:a,frame:o,nonvolatile:oe()});let z=0,B=()=>{Atomics.store(s,5,re());let e=Atomics.load(s,6);e!==z&&(z=e,u.data.set(f),g()),w=requestAnimationFrame(B)};w=requestAnimationFrame(B);let V=(e,t)=>{Atomics.add(s,e,1),j(`${t} added`)};return{stop:E,save:F,restore:()=>void I(),restartLevel:R,setEnhanced:ee,giveGrenade:()=>V(7,`grenade`),giveBomb:()=>V(8,`bomb`)}}var R=`d-generation-aga-sound`,z=`d-generation-aga-enhanced`,B=e=>document.getElementById(e),V=B(`save`),H=B(`restore`),U=B(`restart`),W=B(`grenade`),ue=B(`bomb`),G=B(`enhanced`),K=B(`sound`),de=B(`stopped`),q=B(`status`),J=localStorage.getItem(R)!==`off`;K.textContent=`Sound: ${J?`on`:`off`}`;var Y=localStorage.getItem(z)===`on`,X=null,Z=null;function fe(e){console.error(e),de.textContent=`Game stopped: ${e instanceof Error?e.message:String(e)}`,de.hidden=!1}function Q(){X&&!X.setEnhanced(Y)&&(G.hidden=!0),G.textContent=`Enhanced: ${Y?`on`:`off`}`}V.addEventListener(`click`,()=>{V.blur(),X?.save()}),H.addEventListener(`click`,()=>{H.blur(),X?.restore()}),U.addEventListener(`click`,()=>{U.blur(),X&&confirm(`Restart this level? You go back to where you arrived on this floor.`)&&X.restartLevel()}),W.addEventListener(`click`,()=>{W.blur(),X?.giveGrenade()}),ue.addEventListener(`click`,()=>{ue.blur(),X?.giveBomb()}),K.addEventListener(`click`,()=>{K.blur(),J=!J,localStorage.setItem(R,J?`on`:`off`),K.textContent=`Sound: ${J?`on`:`off`}`,Z?.setMuted(!J),Z?.unlock()}),G.addEventListener(`click`,()=>{G.blur(),Y=!Y,localStorage.setItem(z,Y?`on`:`off`),Q()}),Q();var $=`d-generation-isolation-reload`;crossOriginIsolated?sessionStorage.removeItem($):`serviceWorker`in navigator&&isSecureContext&&!sessionStorage.getItem($)&&(sessionStorage.setItem($,`1`),q.textContent=`Enabling cross-origin isolation...`,await navigator.serviceWorker.register(`coi-sw.js`),await navigator.serviceWorker.ready,location.reload(),await new Promise(()=>{}));try{q.textContent=`Loading...`,Z=new u(await o(ee(document.baseURI)),new e,!J),X=await L({canvas:B(`game`),box:B(`box`),audio:Z,demo:!0,onStatus:e=>q.textContent=e,onStop:e=>{X=null,fe(e)}}),Q()}catch(e){q.textContent=``,fe(e)}