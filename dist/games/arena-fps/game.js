(function(){
const $=id=>document.getElementById(id);
const isTouch=matchMedia('(pointer:coarse)').matches;   // ponteiro principal é o dedo; notebook com tela de toque e mouse continua no modo desktop
document.body.classList.toggle('touch',isTouch);

// ---------- cena ----------
// Pós-processamento (bloom, gradação de cor, FXAA) só no desktop; no celular o render é direto.
const PP=!isTouch&&!/[?&]pp=0/.test(location.search)&&!!(THREE.EffectComposer&&THREE.RenderPass&&THREE.ShaderPass&&THREE.UnrealBloomPass&&THREE.FXAAShader);
const renderer=new THREE.WebGLRenderer({antialias:!PP,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,PP?1.5:2));
// Com pós-processamento o tonemapping e o sRGB são feitos no shader final (GRADE); sem ele, pelo renderer.
renderer.outputEncoding=PP?THREE.LinearEncoding:THREE.sRGBEncoding;
renderer.toneMapping=PP?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.3;// o ACES do three divide a exposição por .6; .3 fica parecido com o shader GRADE (.42)
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
$('view').appendChild(renderer.domElement);
document.body.classList.toggle('pp',PP);
const MAXANI=renderer.capabilities.getMaxAnisotropy();
const scene=new THREE.Scene();
scene.fog=new THREE.Fog(new THREE.Color('#b9b2a2').convertSRGBToLinear(),45,190);
const camera=new THREE.PerspectiveCamera(75,1,.05,220);
camera.rotation.order='YXZ';
scene.add(camera);

// céu físico (Sky.js) e luz do sol na mesma direção
const SUN=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-38),THREE.MathUtils.degToRad(215));
let SKY=null;
if(THREE.Sky){
  const sky=SKY=new THREE.Sky();sky.scale.setScalar(180);
  const u=sky.material.uniforms;u.turbidity.value=2.5;u.rayleigh.value=1.2;u.mieCoefficient.value=.0025;u.mieDirectionalG.value=.85;u.sunPosition.value.copy(SUN);
  // o céu também ilumina e reflete nos materiais (IBL). O disco do sol (x19000) fica fora do mapa de ambiente,
  // senão ele ilumina tudo por igual e objetos escuros ficam cinza-claros; o sol direto vem da DirectionalLight.
  const fs=sky.material.fragmentShader;
  if(fs.includes('* sundisk;')){sky.material.fragmentShader=fs.replace('uniform float mieDirectionalG;','uniform float mieDirectionalG;\nuniform float uDisk;').replace('* sundisk;','* sundisk * uDisk;');u.uDisk={value:0}}
  const tmp=new THREE.Scene();tmp.add(sky);
  const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(tmp).texture;pm.dispose();
  if(u.uDisk)u.uDisk.value=1;
  scene.add(sky);
}else scene.background=new THREE.Color('#9fb6cf').convertSRGBToLinear();
const HEMI=new THREE.HemisphereLight(0xcfe0ff,0x7a6248,.2);scene.add(HEMI);
const sun=new THREE.DirectionalLight(0xffe9cc,1.7);sun.position.copy(SUN).multiplyScalar(50);scene.add(sun);
sun.castShadow=true;sun.shadow.mapSize.set(isTouch?1024:2048,isTouch?1024:2048);
const shc=sun.shadow.camera;shc.left=-34;shc.right=34;shc.top=34;shc.bottom=-34;shc.near=1;shc.far=110;sun.shadow.bias=-.0004;sun.shadow.normalBias=.03;

// pós-processamento: cena em HDR (half float) → bloom leve → tonemapping ACES, cor, vinheta e grão → FXAA
let composer=null,grade=null,fxaa=null,bcPass=null;
if(PP){
  const rt=new THREE.WebGLRenderTarget(innerWidth,innerHeight,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,format:THREE.RGBAFormat,type:THREE.HalfFloatType});
  composer=new THREE.EffectComposer(renderer,rt);
  composer.addPass(new THREE.RenderPass(scene,camera));
  composer.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.22,.5,1.6));
  grade=new THREE.ShaderPass({
    uniforms:{tDiffuse:{value:null},exposure:{value:.42},time:{value:0}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:[
      'uniform sampler2D tDiffuse;uniform float exposure,time;varying vec2 vUv;',
      'vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}',
      'vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}',
      'float rnd(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}',
      'void main(){vec3 c=texture2D(tDiffuse,vUv).rgb*exposure;',
      ' c=aces(c);',
      ' float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,1.08);',            // saturação leve
      ' c*=vec3(1.03,1.,.95);',                                                     // tom quente
      ' c=srgb(c);',
      ' vec2 d=vUv-.5;c*=mix(.68,1.,smoothstep(.82,.28,length(d*vec2(1.25,1.))));',  // vinheta
      ' c+=(rnd(vUv*1000.+time)-.5)*.022;',                                         // grão de filme
      ' gl_FragColor=vec4(c,1.);}'].join('\n')
  });
  composer.addPass(grade);
  fxaa=new THREE.ShaderPass(THREE.FXAAShader);composer.addPass(fxaa);
  // bodycam: lente olho de peixe (barril), aberração cromática, cor lavada e fria, contraste alto, ruído e linhas
  bcPass=new THREE.ShaderPass({
    uniforms:{tDiffuse:{value:null},time:{value:0},faces:{value:Array.from({length:16},()=>new THREE.Vector4())},nf:{value:0}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:[
      'uniform sampler2D tDiffuse;uniform float time;uniform vec4 faces[16];uniform int nf;varying vec2 vUv;',
      'float rnd(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}',
      'void main(){vec2 p=vUv-.5;float r2=dot(p*vec2(1.6,1.),p*vec2(1.6,1.));',
      ' vec2 q=p*(1.+.32*r2)/(1.+.32*.5*1.64);',                                    // barril: bordas comprimidas, cantos ainda cobertos
      ' vec2 c=q*r2*.018,u=q+.5;',
      ' for(int i=0;i<16;i++){if(i>=nf)break;vec4 F=faces[i];vec2 d=(u-F.xy)/F.zw;if(dot(d,d)<1.){vec2 bs=F.zw*.4;u=(floor((u-F.xy)/bs)+.5)*bs+F.xy;c=vec2(0.);}}',   // rosto: mosaico
      ' vec3 col=vec3(texture2D(tDiffuse,u+c).r,texture2D(tDiffuse,u).g,texture2D(tDiffuse,u-c).b);',
      ' float l=dot(col,vec3(.299,.587,.114));col=mix(vec3(l),col,.62);',             // cor lavada
      ' col=(col-.5)*1.18+.5;col*=vec3(.94,1.,1.04);',                                // contraste e tom frio
      ' col+=(rnd(floor(vUv*vec2(480.,270.))+fract(time))-.5)*.07;',                  // ruído de sensor
      ' col*=.965+.035*sin(vUv.y*800.+time*40.);',                                    // linhas de varredura
      ' col*=smoothstep(1.05,.32,length(p*vec2(1.25,1.)));',                          // vinheta forte
      ' gl_FragColor=vec4(clamp(col,0.,1.),1.);}'].join('\n')
  });
  bcPass.enabled=false;composer.addPass(bcPass);
}

let VMP=0;   // 0 em paisagem, até 1 em retrato estreito
let BASEFOV=75,BODY=false,BMODE=0;try{BMODE=Math.min(2,+localStorage.getItem('arenafps_cam')||0);BODY=BMODE>0}catch(e){}   // BMODE: 0 normal, 1 trincheira, 2 casa (preferência à parte do save)
function onResize(){
  const w=innerWidth,h=innerHeight;
  renderer.setSize(w,h);
  camera.aspect=w/h;
  // retrato: mantém o campo de visão horizontal (senão a tela vira um túnel com metade de céu); arma desce e entra para o centro
  const hf=BODY?52:37.5;   // bodycam: lente grande-angular
  camera.fov=BASEFOV=camera.aspect<1?Math.min(120,2*Math.atan(Math.tan(hf*Math.PI/180)/camera.aspect)*180/Math.PI):hf*2;
  VMP=camera.aspect<1?Math.min(1,(1-camera.aspect)*1.6):0;
  camera.updateProjectionMatrix();
  if(composer){composer.setSize(w,h);const pr=renderer.getPixelRatio();fxaa.material.uniforms.resolution.value.set(1/(w*pr),1/(h*pr))}
}
addEventListener('resize',onResize);addEventListener('orientationchange',()=>setTimeout(onResize,200));
onResize();

// ---------- texturas procedurais (cor + mapa normal, emendam sem costura) ----------
const TS=isTouch?256:512;
function mkC(n){const c=document.createElement('canvas');c.width=c.height=n;return c}
function blobs(g,n,count,rmin,rmax,cols,alpha){
  for(let i=0;i<count;i++){
    const x=Math.random()*n,y=Math.random()*n,r=n*(rmin+Math.random()*(rmax-rmin));
    g.fillStyle=cols[i%cols.length];g.globalAlpha=alpha*(.3+Math.random()*.7);
    for(const ox of [-n,0,n])for(const oy of [-n,0,n]){if(Math.abs(x+ox-n/2)>n/2+r||Math.abs(y+oy-n/2)>n/2+r)continue;g.beginPath();g.arc(x+ox,y+oy,r,0,6.283);g.fill()}
  }
  g.globalAlpha=1;
}
function grain(g,n,amt){const d=g.getImageData(0,0,n,n),p=d.data;for(let i=0;i<p.length;i+=4){const r=(Math.random()-.5)*amt;p[i]+=r;p[i+1]+=r;p[i+2]+=r}g.putImageData(d,0,0)}
function normalOf(c,str){
  const n=c.width,s=c.getContext('2d').getImageData(0,0,n,n).data,o=mkC(n),og=o.getContext('2d'),od=og.createImageData(n,n),q=od.data;
  const h=(x,y)=>{x=(x+n)%n;y=(y+n)%n;const i=(y*n+x)*4;return(s[i]+s[i+1]+s[i+2])/765};
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const dx=(h(x+1,y)-h(x-1,y))*str,dy=(h(x,y+1)-h(x,y-1))*str,l=Math.hypot(dx,dy,1),i=(y*n+x)*4;
    q[i]=(-dx/l*.5+.5)*255;q[i+1]=(dy/l*.5+.5)*255;q[i+2]=(1/l*.5+.5)*255;q[i+3]=255;
  }
  og.putImageData(od,0,0);return o;
}
function mat(draw,nstr,o){
  const c=mkC(TS),g=c.getContext('2d');draw(g,TS);
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;
  const nm=new THREE.CanvasTexture(normalOf(c,nstr));
  [t,nm].forEach(x=>{x.wrapS=x.wrapT=THREE.RepeatWrapping;x.anisotropy=MAXANI});
  return new THREE.MeshStandardMaterial(Object.assign({map:t,normalMap:nm,roughness:.9,metalness:0},o||{}));
}
// concreto do chão: placas, manchas, rachaduras e juntas
const floorM=mat((g,n)=>{
  g.fillStyle='#7f796d';g.fillRect(0,0,n,n);
  blobs(g,n,90,.05,.2,['#736c60','#958c7c','#857c6c'],.28);
  blobs(g,n,220,.003,.01,['#5f5a51','#a49c8b'],.2);
  g.strokeStyle='rgba(40,36,30,.55)';g.lineWidth=n/170;
  g.strokeStyle='rgba(40,36,30,.3)';g.lineWidth=n/400;for(let k=0;k<2;k++){g.beginPath();let x=Math.random()*n,y=Math.random()*n,a=Math.random()*6.283;g.moveTo(x,y);for(let s=0;s<14;s++){a+=(Math.random()-.5)*.9;x+=Math.cos(a)*n*.025;y+=Math.sin(a)*n*.025;g.lineTo(x,y)}g.stroke()}
  g.fillStyle='rgba(30,28,24,.8)';g.fillRect(0,0,n,n/128);g.fillRect(0,0,n/128,n);
  grain(g,n,22);
},5,{roughness:.93,envMapIntensity:.45});
// reboco de arenito das paredes: sujeira concentrada embaixo e lascas
const wallM=mat((g,n)=>{
  g.fillStyle='#c4ad86';g.fillRect(0,0,n,n);
  blobs(g,n,120,.03,.15,['#b39b74','#d2bd98','#a88f69'],.35);
  for(let i=0;i<14;i++){g.fillStyle='rgba(120,92,62,'+(.25+Math.random()*.3)+')';const w=n*(.03+Math.random()*.08),x=Math.random()*n,y=Math.random()*n*.85;g.fillRect(x,y,w,w*.6)}
  const gr=g.createLinearGradient(0,n*.62,0,n);gr.addColorStop(0,'rgba(70,55,40,0)');gr.addColorStop(1,'rgba(70,55,40,.55)');g.fillStyle=gr;g.fillRect(0,0,n,n);
  for(let i=0;i<40;i++){g.fillStyle='rgba(80,64,48,.12)';const x=Math.random()*n;g.fillRect(x,n*(.1+Math.random()*.4),n/260,n*(.1+Math.random()*.4))}
  grain(g,n,26);
},4,{roughness:.95,envMapIntensity:.6});
// caixote de madeira: tábuas, veios, moldura, travessas e pregos
const woodM=mat((g,n)=>{
  const P=6,ph=n/P;
  for(let i=0;i<P;i++){
    const b=110+Math.random()*30;g.fillStyle='rgb('+b+','+(b*.74|0)+','+(b*.47|0)+')';g.fillRect(0,i*ph,n,ph);
    for(let j=0;j<26;j++){g.fillStyle='rgba(60,38,20,'+(.08+Math.random()*.14)+')';g.fillRect(Math.random()*n,i*ph+Math.random()*ph,n*(.1+Math.random()*.4),Math.max(1,n/400))}
    g.fillStyle='rgba(30,20,10,.75)';g.fillRect(0,i*ph,n,n/220);
  }
  const fw=n*.09;g.fillStyle='#6e4d2c';g.fillRect(0,0,n,fw);g.fillRect(0,n-fw,n,fw);g.fillRect(0,0,fw,n);g.fillRect(n-fw,0,fw,n);
  g.strokeStyle='#6e4d2c';g.lineWidth=fw*.8;g.beginPath();g.moveTo(fw,fw);g.lineTo(n-fw,n-fw);g.stroke();
  g.strokeStyle='rgba(25,15,8,.6)';g.lineWidth=n/200;g.strokeRect(fw,fw,n-2*fw,n-2*fw);g.strokeRect(1,1,n-2,n-2);
  g.fillStyle='#3a3530';[[fw/2,fw/2],[n-fw/2,fw/2],[fw/2,n-fw/2],[n-fw/2,n-fw/2],[n/2,fw/2],[n/2,n-fw/2]].forEach(p=>{g.beginPath();g.arc(p[0],p[1],n/90,0,6.283);g.fill()});
  grain(g,n,18);
},7,{roughness:.82});
// bloco de concreto com faixa amarela desbotada e escorridos
const conM=mat((g,n)=>{
  g.fillStyle='#8e8c86';g.fillRect(0,0,n,n);
  blobs(g,n,110,.03,.14,['#7c7a74','#a09d96','#85837c'],.35);
  blobs(g,n,260,.003,.015,['#5d5b56'],.5);
  const sh=n*.16;for(let i=0;i<8;i++){g.fillStyle='rgba(205,160,40,'+(.6+Math.random()*.25)+')';g.beginPath();const x=i*n/8;g.moveTo(x,n);g.lineTo(x+n/16,n);g.lineTo(x+n/8,n-sh);g.lineTo(x+n/16,n-sh);g.fill()}
  for(let i=0;i<120;i++){g.fillStyle='rgba(140,138,130,.9)';g.fillRect(Math.random()*n,n-sh+Math.random()*sh,n/60,n/90)}
  for(let i=0;i<30;i++){g.fillStyle='rgba(60,55,48,.14)';g.fillRect(Math.random()*n,0,n/180,n*(.2+Math.random()*.5))}
  g.strokeStyle='rgba(50,48,44,.6)';g.lineWidth=n/120;g.strokeRect(0,0,n,n);
  grain(g,n,24);
},5,{roughness:.9});
function ctex(fn){const c=mkC(128);fn(c.getContext('2d'));const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;t.anisotropy=8;return t}
const camoT=ctex(g=>{g.fillStyle='#46513a';g.fillRect(0,0,128,128);['#2f3a29','#6b6a4a','#222a1f'].forEach(c=>{g.fillStyle=c;for(let i=0;i<14;i++){g.beginPath();g.ellipse(Math.random()*128,Math.random()*128,8+Math.random()*16,5+Math.random()*10,Math.random()*3,0,6.283);g.fill()}})});

// ---------- mapas ----------
// MAP1 (arena), MAP2 (trincheira) e MAP3 (casa) — os dois últimos são do modo bodycam — ficam na cena; setMap() mostra um
// e troca colisões, itens, sol, céu e névoa.
const MAP1=new THREE.Group(),MAP2=new THREE.Group(),MAP3=new THREE.Group(),MAPG=[MAP1,MAP2,MAP3];MAP2.visible=MAP3.visible=false;scene.add(MAP1,MAP2,MAP3);let MG=MAP1;   // MG: grupo que recebe as peças em addBox
const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),floorM);
floorM.map.repeat.set(15,15);floorM.normalMap.repeat.set(15,15);
floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;MAP1.add(floor);
// postes (decoração; de dia ficam apagados)
const poleM=new THREE.MeshStandardMaterial({color:0x2a2d33,metalness:.8,roughness:.45}),lampM=new THREE.MeshStandardMaterial({color:0x9a9890,metalness:.3,roughness:.6});
[[-22,-22],[22,-22],[-22,22],[22,22]].forEach(p=>{
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.08,.1,5,10),poleM);pole.position.set(p[0],2.5,p[1]);pole.castShadow=true;MAP1.add(pole);
  const lh=new THREE.Mesh(new THREE.BoxGeometry(.5,.12,.3),lampM);lh.position.set(p[0],5.05,p[1]);lh.castShadow=true;MAP1.add(lh);
});
// poeira suspensa no ar
const dustG=new THREE.BufferGeometry(),DN=isTouch?120:260,dp=new Float32Array(DN*3);
for(let i=0;i<DN;i++){dp[i*3]=(Math.random()*2-1)*29;dp[i*3+1]=Math.random()*5;dp[i*3+2]=(Math.random()*2-1)*29}
dustG.setAttribute('position',new THREE.BufferAttribute(dp,3));
const dust=new THREE.Points(dustG,new THREE.PointsMaterial({color:0xfff2d6,size:.035,transparent:true,opacity:.45,depthWrite:false}));scene.add(dust);
function updateDust(dt){const a=dustG.attributes.position.array;for(let i=0;i<DN;i++){a[i*3]+=Math.sin(i+performance.now()*.0002)*dt*.08;a[i*3+1]+=dt*.03;if(a[i*3+1]>5)a[i*3+1]=0}dustG.attributes.position.needsUpdate=true}

const solids=[],boxes=[];
const PICK1=[[-25,-4],[25,-6],[3,-24],[-12,-22],[12,22],[-26,24],[26,24],[-4,1],[7,3]];   // itens no mapa 1
let HALF=30,CEIL=0;   // metade do lado do mapa atual e altura do teto (0 = céu aberto)
// UV por face proporcional ao tamanho, com número inteiro de repetições (a textura não estica)
function fitUV(geo,w,h,d,t){
  const uv=geo.attributes.uv,dims=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
  for(let f=0;f<6;f++)for(let k=0;k<4;k++){const i=f*4+k;uv.setXY(i,uv.getX(i)*Math.max(1,Math.round(dims[f][0]/t)),uv.getY(i)*Math.max(1,Math.round(dims[f][1]/t)))}
  uv.needsUpdate=true;
}
function addBox(x,z,w,d,h,m,t){
  const geo=new THREE.BoxGeometry(w,h,d);fitUV(geo,w,h,d,t);
  const o=new THREE.Mesh(geo,m);
  o.position.set(x,h/2,z);o.castShadow=o.receiveShadow=true;MG.add(o);solids.push(o);
  return {minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,h};
}
[[0,-HALF-.5,61,1],[0,HALF+.5,61,1],[-HALF-.5,0,1,61],[HALF+.5,0,1,61]].forEach(a=>addBox(a[0],a[1],a[2],a[3],5,wallM,5));
[[-8,-6,4,4,3],[9,-8,3,6,2.5],[0,8,6,2,2],[-14,10,3,3,3],[14,12,4,4,2],[0,-16,8,2,3],[-18,-14,2,6,2.5],[20,0,2,8,3],[-20,0,2,8,2.2]]
 .forEach(a=>boxes.push(a[4]>2.5?addBox(a[0],a[1],a[2],a[3],a[4],conM,3):addBox(a[0],a[1],a[2],a[3],a[4],woodM,1.25)));

// chão "assado": oclusão de ambiente junto às paredes e caixas + manchas grandes que quebram a repetição do concreto.
// Uma textura no chão inteiro (uv2): serve de aoMap (luz do céu) e escurece a cor (sujeira acumulada nos cantos).
function bakeFloor(B,H,mesh,m){                                    // B: caixas, H: metade do lado do mapa
  const N=isTouch?512:1024,c=mkC(N),g=c.getContext('2d'),k=N/(2*H),X=x=>(x+H)*k;   // canvas y=0 fica em z=-H
  g.fillStyle='#fff';g.fillRect(0,0,N,N);
  blobs(g,N,70,.04,.16,['#d8d0c4','#e8e2d8','#cfc6b6'],.5);                       // manchas grandes de sujeira/umidade
  blobs(g,N,30,.01,.035,['#a89c8a','#bdb19e'],.45);
  const soft=(x,z,w,d,blur,a)=>{g.save();g.shadowColor='rgba(0,0,0,'+a+')';g.shadowBlur=blur*k;g.shadowOffsetX=N*2;g.fillStyle='#000';g.fillRect(X(x-w/2)-N*2,X(z-d/2),w*k,d*k);g.restore()};   // retângulo desfocado (shadowBlur funciona em todo navegador)
  for(let i=0;i<2;i++){soft(0,-H,2*H,.6,2.2,.75);soft(0,H,2*H,.6,2.2,.75);soft(-H,0,.6,2*H,2.2,.75);soft(H,0,.6,2*H,2.2,.75)}   // paredes
  for(const o of B){const w=o.maxX-o.minX,d=o.maxZ-o.minZ,x=(o.minX+o.maxX)/2,z=(o.minZ+o.maxZ)/2;soft(x,z,w+.3,d+.3,1.6+o.h*.25,.85);soft(x,z,w,d,.5,.9)}
  const t=new THREE.CanvasTexture(c);t.anisotropy=MAXANI;
  mesh.geometry.setAttribute('uv2',new THREE.PlaneGeometry(1,1).attributes.uv.clone());   // 0–1 no chão inteiro, mesmo se o uv da textura repetir
  m.aoMap=t;m.aoMapIntensity=1;
  m.onBeforeCompile=s=>{s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n diffuseColor.rgb*=mix(1.,texture2D(aoMap,vUv2).r,.55);')};
  m.needsUpdate=true;
}
bakeFloor(boxes,30,floor,floorM);

// cidade em volta da arena: prédios que somem na névoa, para o horizonte não ficar vazio (sem colisão, sem sombra)
(function(){
  const facM=mat((g,n)=>{                                                          // fachada: um andar (3 m) com uma janela por textura
    g.fillStyle='#a49a88';g.fillRect(0,0,n,n);blobs(g,n,40,.03,.12,['#968c7a','#b3a996'],.35);
    g.fillStyle='#2d3238';g.fillRect(n*.2,n*.22,n*.6,n*.5);
    const gl=g.createLinearGradient(0,n*.22,0,n*.72);gl.addColorStop(0,'rgba(170,190,210,.35)');gl.addColorStop(1,'rgba(40,50,60,0)');g.fillStyle=gl;g.fillRect(n*.2,n*.22,n*.6,n*.5);
    g.fillStyle='#8a8070';g.fillRect(n*.16,n*.72,n*.68,n*.05);                      // peitoril
    const gr=g.createLinearGradient(0,n*.75,0,n);gr.addColorStop(0,'rgba(60,50,40,.25)');gr.addColorStop(1,'rgba(60,50,40,0)');g.fillStyle=gr;g.fillRect(0,n*.75,n,n*.25);   // escorrido
    grain(g,n,20);
  },3,{roughness:.85,envMapIntensity:.5});
  const roofM=new THREE.MeshStandardMaterial({color:0x6d675e,roughness:.95});
  const gnd=new THREE.Mesh(new THREE.PlaneGeometry(360,360),new THREE.MeshStandardMaterial({color:new THREE.Color('#8a8272').convertSRGBToLinear(),roughness:1}));
  gnd.rotation.x=-Math.PI/2;gnd.position.y=-.02;MAP1.add(gnd);
  const tints=['#ffffff','#e9d6c0','#c9ccd0','#d8c9a8','#b9aa98'].map(c=>{const m=facM.clone();m.color.set(c);return m});   // mesma textura, cores diferentes
  const n=isTouch?26:44;
  for(let i=0;i<n;i++){
    const a=i/n*6.283+Math.random()*.1,r=62+Math.random()*(i%3?30:80),w=8+Math.random()*14,d=8+Math.random()*14,h=3*Math.round(2+Math.random()*(r>100?12:6)),fm=tints[i%tints.length];
    const geo=new THREE.BoxGeometry(w,h,d);fitUV(geo,w,h,d,3);
    const b=new THREE.Mesh(geo,[fm,fm,roofM,roofM,fm,fm]);b.position.set(Math.cos(a)*r,h/2,Math.sin(a)*r);b.rotation.y=Math.random()*6.283;
    b.matrixAutoUpdate=false;b.updateMatrix();MAP1.add(b);
  }
})();

// ---------- mapas do modo bodycam: trincheira (MAP2) e casa (MAP3), ao ar livre no fim de tarde ----------
// Sol baixo (9°), luz quente e sombras longas; o céu muda de cor e gera outro ambiente (PMREM) para os reflexos.
// Inimigos andam em linha reta: trincheiras com passagens largas e casa com portas de 1,4 m.
const MAPS=[{half:30,ceil:0,start:[0,22],pick:PICK1,solids:solids.slice(),boxes:boxes.slice()}];
const SUN2=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-10),THREE.MathUtils.degToRad(212));   // à frente e à esquerda de quem começa (olhando para -z)
function skyEnv(dir,turb,ray){                                       // ambiente (PMREM) de um céu com o sol em `dir`
  if(!SKY)return scene.environment;const u=SKY.material.uniforms,o=[u.sunPosition.value.clone(),u.turbidity.value,u.rayleigh.value];
  u.sunPosition.value.copy(dir);u.turbidity.value=turb;u.rayleigh.value=ray;if(u.uDisk)u.uDisk.value=0;
  const tmp=new THREE.Scene();tmp.add(SKY);const pm=new THREE.PMREMGenerator(renderer),t=pm.fromScene(tmp).texture;pm.dispose();
  if(u.uDisk)u.uDisk.value=1;u.sunPosition.value.copy(o[0]);u.turbidity.value=o[1];u.rayleigh.value=o[2];scene.add(SKY);return t;
}
const dirtM=mat((g,n)=>{g.fillStyle='#836a4c';g.fillRect(0,0,n,n);                  // terra batida com tufos de capim seco
  blobs(g,n,90,.03,.12,['#5f4c36','#7d6649','#66533b'],.4);blobs(g,n,140,.005,.02,['#4a3a28','#8a7354'],.35);
  for(let i=0;i<260;i++){g.strokeStyle='rgba('+(120+Math.random()*50|0)+','+(110+Math.random()*40|0)+',60,.55)';g.lineWidth=n/400;const x=Math.random()*n,y=Math.random()*n;
    g.beginPath();for(let k=0;k<4;k++){g.moveTo(x,y);g.lineTo(x+(Math.random()-.5)*n*.02,y-n*(.01+Math.random()*.015))}g.stroke()}
  grain(g,n,22)},4,{roughness:1,envMapIntensity:.5});
const sandM=mat((g,n)=>{g.fillStyle='#4f4632';g.fillRect(0,0,n,n);const R=4,bh=n/R;    // sacos de areia em fileiras desencontradas
  for(let r=0;r<R;r++){const off=r%2?n/6:0;for(let c=-1;c<4;c++){const x=c*n/3+off,y=r*bh,b=150+Math.random()*25;
    g.fillStyle='rgb('+b+','+(b*.86|0)+','+(b*.62|0)+')';g.beginPath();g.ellipse(x+n/6,y+bh/2,n/6-3,bh/2-3,0,0,6.283);g.fill();
    g.strokeStyle='rgba(60,50,30,.5)';g.lineWidth=n/200;g.beginPath();g.moveTo(x+n/12,y+bh*.3);g.lineTo(x+n/12,y+bh*.7);g.stroke()}}
  blobs(g,n,60,.01,.05,['#6b5a3c','#3f3524'],.35);grain(g,n,20)},6,{roughness:.95,envMapIntensity:.4});
const plankM=mat((g,n)=>{const P=7,w=n/P;for(let i=0;i<P;i++){const b=105+Math.random()*30;   // tábuas velhas e acinzentadas
  g.fillStyle='rgb('+b+','+(b*.9|0)+','+(b*.78|0)+')';g.fillRect(i*w,0,w,n);for(let k=0;k<20;k++){g.fillStyle='rgba(40,32,24,'+(.1+Math.random()*.15)+')';g.fillRect(i*w+Math.random()*w,Math.random()*n,n/500+1,n*(.1+Math.random()*.4))}
  g.fillStyle='rgba(20,15,10,.7)';g.fillRect(i*w,0,n/180,n)}grain(g,n,20)},6,{roughness:.9,envMapIntensity:.35});
const roofM=new THREE.MeshStandardMaterial({color:new THREE.Color('#5a3f30').convertSRGBToLinear(),roughness:.8,metalness:.3,envMapIntensity:.4});
const rustM=new THREE.MeshStandardMaterial({color:new THREE.Color('#6b4630').convertSRGBToLinear(),roughness:.7,metalness:.5,envMapIntensity:.4});
const barkM=new THREE.MeshStandardMaterial({color:new THREE.Color('#3b3128').convertSRGBToLinear(),roughness:1,envMapIntensity:.3});
const darkM=new THREE.MeshStandardMaterial({color:0x151412,roughness:.9});
const CRATER=fxTex(128,(x,n)=>{const g=x.createRadialGradient(n/2,n/2,n*.08,n/2,n/2,n/2);g.addColorStop(0,'rgba(25,20,15,.85)');g.addColorStop(.6,'rgba(45,35,25,.55)');g.addColorStop(1,'rgba(60,50,35,0)');x.fillStyle=g;x.fillRect(0,0,n,n)});
const CRATG=new THREE.PlaneGeometry(1,1),craterM=new THREE.MeshBasicMaterial({map:CRATER,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,color:new THREE.Color(1,1,1).multiplyScalar(PP?.6:1)});
const TRUNK=new THREE.CylinderGeometry(.08,.16,1,6),BRANCH=new THREE.CylinderGeometry(.02,.06,1,5);
function tree(x,z,s,sh){                                             // árvore seca: tronco e galhos tortos
  const t=new THREE.Group(),h=4.5*s,tr=new THREE.Mesh(TRUNK,barkM);tr.scale.set(s,h,s);tr.position.y=h/2;t.add(tr);
  for(let i=0;i<5;i++){const b=new THREE.Mesh(BRANCH,barkM),L=(1.2+Math.random()*1.4)*s,a=Math.random()*6.28,e=.5+Math.random()*.6;
    b.scale.set(s,L,s);b.position.set(Math.cos(a)*Math.sin(e)*L/2,h*(.55+i*.09)+Math.cos(e)*L/2,Math.sin(a)*Math.sin(e)*L/2);b.lookAt(b.position.clone().multiplyScalar(3).setY(b.position.y+Math.cos(e)*L*2));b.rotateX(Math.PI/2);t.add(b)}
  t.position.set(x,0,z);t.rotation.y=Math.random()*6.28;t.traverse(o=>{if(o.isMesh)o.castShadow=!!sh});MG.add(t);
}
function vis(x,y,z,w,h,d,m,t,solid){                                 // peça só visual (não bloqueia o passo); `solid`: para as balas
  const geo=new THREE.BoxGeometry(w,h,d);if(t)fitUV(geo,w,h,d,t);const o=new THREE.Mesh(geo,m);o.position.set(x,y+h/2,z);o.castShadow=o.receiveShadow=true;MG.add(o);if(solid)solids.push(o);return o}
function ground(H,tile,gm){                                             // chão do mapa (com oclusão assada) e terreno além da cerca
  const fl=new THREE.Mesh(new THREE.PlaneGeometry(2*H,2*H),(gm||dirtM).clone()),uv=fl.geometry.attributes.uv;
  for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*2*H/tile,uv.getY(i)*2*H/tile);fl.rotation.x=-Math.PI/2;fl.receiveShadow=true;MG.add(fl);
  const far=new THREE.Mesh(new THREE.PlaneGeometry(400,400),new THREE.MeshStandardMaterial({color:new THREE.Color('#5c4a35').convertSRGBToLinear(),roughness:1}));
  far.rotation.x=-Math.PI/2;far.position.y=-.03;MG.add(far);return fl;
}
function treeRing(H){for(let i=0;i<(isTouch?18:34);i++){const a=i/(isTouch?18:34)*6.28+Math.random()*.15,r=H+6+Math.random()*30;tree(Math.cos(a)*r,Math.sin(a)*r,.8+Math.random()*.8,r<H+14)}}
function mapEnd(i,H,start,pick,fl){bakeFloor(boxes,H,fl,fl.material);MAPS[i]={half:H,ceil:0,start,pick,solids:solids.slice(),boxes:boxes.slice()}}
(function(){
  const keepS=solids.slice(),keepB=boxes.slice(),B=(x,z,w,d,h,m,t)=>boxes.push(addBox(x,z,w,d,h,m,t));
  // ----- trincheira: rede de valas de terra (~2 m) numa floresta queimada. O chão do jogo é plano, então as valas são
  // corredores no nível do chão e o "terreno de cima" são blocos de terra; árvores e troncos caídos ficam em cima deles.
  solids.length=0;boxes.length=0;MG=MAP2;let H=30;const fl2=ground(H,5);
  const C=2,N=30,G=[];for(let r=0;r<N;r++)G.push(new Array(N).fill(1));   // grade de 2 m: 1 = terra, 0 = vala
  const cv=(c0,r0,c1,r1)=>{for(let r=Math.min(r0,r1);r<=Math.max(r0,r1);r++)for(let c=Math.min(c0,c1);c<=Math.max(c0,c1);c++)G[r][c]=0};
  cv(2,25,8,25);cv(8,23,8,25);cv(8,23,14,23);cv(14,23,14,25);cv(14,25,20,25);cv(20,23,20,25);cv(20,23,27,23);   // linha sul em zigue-zague
  cv(2,14,9,14);cv(9,12,9,14);cv(9,12,16,12);cv(16,12,16,15);cv(16,15,23,15);cv(23,13,23,15);cv(23,13,27,13);     // linha do meio
  cv(2,4,10,4);cv(10,4,10,6);cv(10,6,18,6);cv(18,3,18,6);cv(18,3,27,3);                                             // linha norte
  cv(2,4,2,25);cv(27,3,27,23);cv(5,4,5,14);cv(13,6,13,12);cv(19,15,19,25);cv(23,3,23,7);cv(2,19,4,19);             // valas de ligação
  cv(22,7,24,9);cv(4,18,6,20);                                                                                      // abrigos mais largos
  const wx=c=>c*C-H,dirtW=mat((g,n)=>{g.fillStyle='#7a6248';g.fillRect(0,0,n,n);                                   // parede de terra com raízes e pedras
    blobs(g,n,80,.03,.14,['#6a5440','#8a7055','#5c4936'],.45);blobs(g,n,70,.005,.02,['#3e3226','#a08868'],.5);
    g.strokeStyle='rgba(50,38,26,.55)';for(let k=0;k<26;k++){g.lineWidth=n/(250+Math.random()*300);g.beginPath();let x=Math.random()*n,y=Math.random()*n;g.moveTo(x,y);for(let q=0;q<6;q++){x+=(Math.random()-.5)*n*.08;y+=n*.03;g.lineTo(x,y)}g.stroke()}
    grain(g,n,26)},7,{roughness:1,envMapIntensity:.45});
  const used=G.map(r=>r.map(()=>0));                                 // junta a terra em retângulos (menos caixas para colisão e desenho)
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){if(!G[r][c]||used[r][c])continue;let w=1;while(c+w<N&&G[r][c+w]&&!used[r][c+w])w++;
    let h=1;while(r+h<N){let ok=true;for(let k=0;k<w;k++)if(!G[r+h][c+k]||used[r+h][c+k]){ok=false;break}if(!ok)break;h++}
    for(let a=0;a<h;a++)for(let k=0;k<w;k++)used[r+a][c+k]=1;
    B(wx(c)+w*C/2,wx(r)+h*C/2,w*C,h*C,1.85+Math.random()*.45,dirtW,1.6)}
  const lip=new THREE.BoxGeometry(1,1,1);                            // torrões e pedras na borda das valas: quebram a parede reta
  for(let r=1;r<N-1;r++)for(let c=1;c<N-1;c++)if(!G[r][c])for(const [dc,dr] of[[1,0],[-1,0],[0,1],[0,-1]])if(G[r+dr][c+dc]&&Math.random()<.55){
    const m=new THREE.Mesh(lip,dirtW),sz=.3+Math.random()*.5,x=wx(c)+C/2+dc*(C/2-.05)+(dr?(Math.random()-.5)*1.4:0),z=wx(r)+C/2+dr*(C/2-.05)+(dc?(Math.random()-.5)*1.4:0);
    m.scale.set(sz,sz*(.6+Math.random()),sz);m.position.set(x,Math.random()<.5?sz*.3:1.9+Math.random()*.2,z);m.rotation.set(Math.random(),Math.random()*3,Math.random());m.castShadow=m.receiveShadow=true;MG.add(m)}
  [[3,25,'z'],[8,24,'x'],[16,15,'z'],[27,10,'x'],[13,9,'x'],[19,20,'x']].forEach(([c,r,ax])=>{for(let k=-2;k<=2;k++)   // tábuas de escoramento
    vis(wx(c)+C/2+(ax==='z'?k*.35:-.97),0,wx(r)+C/2+(ax==='x'?k*.35:-.97),ax==='z'?.3:.06,1.9,ax==='x'?.3:.06,plankM)});
  [[24,8],[5,19],[11,23]].forEach(([c,r])=>vis(wx(c)+C/2,0,wx(r)+C/2-.6,1.6,.45,.5,sandM,0,true));                   // sacos de areia soltos
  B(wx(24)+1,wx(9)+1.2,1.2,.8,.9,woodM,1.25);B(wx(5)+.5,wx(18)+.6,1,1,.8,woodM,1.25);                                // caixas nos abrigos
  // floresta queimada em cima da terra (instanciada: uma malha para todos os troncos e outra para os galhos)
  const top=[];for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(G[r][c])top.push([c,r]);
  const TRS=[];for(let k=0;k<(isTouch?70:150);k++){const q=top[Math.random()*top.length|0];TRS.push([wx(q[0])+.2+Math.random()*1.6,wx(q[1])+.2+Math.random()*1.6,2.05])}
  for(let k=0;k<(isTouch?40:90);k++){const a=Math.random()*6.28,r=H+2+Math.random()*28;TRS.push([Math.cos(a)*r,Math.sin(a)*r,0])}
  const burnt=new THREE.MeshStandardMaterial({color:new THREE.Color('#5d5349').convertSRGBToLinear(),roughness:1,envMapIntensity:.35});
  const tr=new THREE.InstancedMesh(new THREE.CylinderGeometry(.06,.14,1,6),burnt,TRS.length),br=new THREE.InstancedMesh(new THREE.CylinderGeometry(.015,.04,1,4),burnt,TRS.length*3);
  const M4=new THREE.Matrix4(),Q=new THREE.Quaternion(),E=new THREE.Euler(),V=new THREE.Vector3(),S=new THREE.Vector3();
  TRS.forEach((t,k)=>{const h=9+Math.random()*9,s=.8+Math.random()*.7;E.set((Math.random()-.5)*.06,0,(Math.random()-.5)*.06);Q.setFromEuler(E);
    tr.setMatrixAt(k,M4.compose(V.set(t[0],t[2]+h/2,t[1]),Q,S.set(s,h,s)));
    for(let b=0;b<3;b++){const L=.8+Math.random()*1.6,a=Math.random()*6.28,y=t[2]+h*(.55+Math.random()*.4);E.set(Math.cos(a)*1.1,0,Math.sin(a)*1.1);Q.setFromEuler(E);
      const d=new THREE.Vector3(0,L/2,0).applyQuaternion(Q);br.setMatrixAt(k*3+b,M4.compose(V.set(t[0]+d.x,y+d.y,t[1]+d.z),Q,S.set(1,L,1)))}});
  tr.castShadow=br.castShadow=true;MG.add(tr,br);
  const logs=new THREE.InstancedMesh(new THREE.CylinderGeometry(.18,.22,1,7),burnt,isTouch?20:40);   // troncos caídos (alguns por cima da beira)
  for(let k=0;k<logs.count;k++){const q=top[Math.random()*top.length|0],L=3+Math.random()*5;E.set(Math.PI/2,Math.random()*6.28,(Math.random()-.5)*.3,'YXZ');Q.setFromEuler(E);
    logs.setMatrixAt(k,M4.compose(V.set(wx(q[0])+1,2.1+Math.random()*.15,wx(q[1])+1),Q,S.set(1,L,1)))}
  logs.castShadow=logs.receiveShadow=true;MG.add(logs);
  const pyl=[],P4=(x,y,z)=>pyl.push(new THREE.Vector3(x,y,z));     // torre de energia treliçada ao fundo
  for(let y=0;y<30;y+=3){const a=4-y*.11,b=4-(y+3)*.11;for(const [sx,sz] of[[1,1],[1,-1],[-1,-1],[-1,1]]){P4(sx*a,y,sz*a);P4(sx*b,y+3,sz*b)}
    for(const [p,q] of[[[1,1],[1,-1]],[[1,-1],[-1,-1]],[[-1,-1],[-1,1]],[[-1,1],[1,1]]]){P4(p[0]*a,y,p[1]*a);P4(q[0]*b,y+3,q[1]*b);P4(q[0]*a,y,q[1]*a);P4(p[0]*b,y+3,p[1]*b)}}
  P4(-8,27,0);P4(8,27,0);P4(-6,22,0);P4(6,22,0);
  const pylon=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pyl),new THREE.LineBasicMaterial({color:0x3a3d40}));pylon.position.set(-18,0,-55);MG.add(pylon);
  const pk=[];for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(!G[r][c]&&(r+c)%7===0)pk.push([wx(c)+1,wx(r)+1]);
  mapEnd(1,H,[wx(19)+1,wx(22)+1],pk.sort(()=>Math.random()-.5).slice(0,10),fl2);MAPS[1].flow=true;
  // ----- casa: sobrado de madeira branca (dois andares, telhado cinza de duas águas, varanda com colunas, grade e lonas),
  // andaime ao lado, quintal de cascalho com entulho, blocos e pilares de concreto, tambores e um carro coberto por lona.
  // Só o térreo é jogável (não há escadas no jogo); o andar de cima é a casca com janelas.
  solids.length=0;boxes.length=0;MG=MAP3;H=26;
  const gravelM=mat((g,n)=>{g.fillStyle='#857a6c';g.fillRect(0,0,n,n);blobs(g,n,70,.03,.12,['#776d60','#958a7b','#6c6357'],.4);
    for(let k=0;k<700;k++){const v=90+Math.random()*90|0;g.fillStyle='rgba('+v+','+(v*.95|0)+','+(v*.88|0)+','+(.5+Math.random()*.4)+')';g.beginPath();g.ellipse(Math.random()*n,Math.random()*n,n*(.003+Math.random()*.012),n*(.003+Math.random()*.009),Math.random()*3,0,6.283);g.fill()}
    grain(g,n,22)},6,{roughness:1,envMapIntensity:.5});
  const sidingM=mat((g,n)=>{const R=8,h=n/R;for(let r=0;r<R;r++){const b=205+Math.random()*20;g.fillStyle='rgb('+b+','+(b-2|0)+','+(b-8|0)+')';g.fillRect(0,r*h,n,h);   // tábuas horizontais brancas e gastas
      g.fillStyle='rgba(255,255,255,.5)';g.fillRect(0,r*h,n,h*.12);g.fillStyle='rgba(60,58,52,.45)';g.fillRect(0,(r+1)*h-h*.12,n,h*.12)}
    for(let k=0;k<30;k++){g.fillStyle='rgba(110,104,92,'+(.06+Math.random()*.12)+')';g.fillRect(Math.random()*n,Math.random()*n*.6,n/150+Math.random()*n/90,n*(.1+Math.random()*.5))}   // escorridos
    blobs(g,n,26,.01,.04,['#9c968a','#b8b2a6'],.45);grain(g,n,14)},4,{roughness:.85,envMapIntensity:.55});
  const shingleM=mat((g,n)=>{const R=10,h=n/R;for(let r=0;r<R;r++){const off=r%2?n/12:0;for(let c=-1;c<7;c++){const v=92+Math.random()*26;g.fillStyle='rgb('+v+','+(v*1.02|0)+','+(v*1.05|0)+')';g.fillRect(c*n/6+off+1,r*h+1,n/6-2,h-2)}
    g.fillStyle='rgba(30,30,32,.5)';g.fillRect(0,(r+1)*h-2,n,2)}grain(g,n,16)},5,{roughness:.9,envMapIntensity:.4});
  const plainCon=mat((g,n)=>{g.fillStyle='#7d7a72';g.fillRect(0,0,n,n);blobs(g,n,90,.02,.1,['#6f6c65','#8c8981','#64615b'],.45);blobs(g,n,160,.003,.012,['#4a4844'],.5);grain(g,n,22)},5,{roughness:.95,envMapIntensity:.35});
  const winT=fxTex(128,(x,n)=>{x.fillStyle='#e9e7e0';x.fillRect(0,0,n,n);const m=n*.1;x.fillStyle='#1d2228';x.fillRect(m,m,n-2*m,n-2*m);   // janela: moldura branca, vidro escuro em 6 painéis
    const gr=x.createLinearGradient(0,0,n,n);gr.addColorStop(0,'rgba(170,190,210,.35)');gr.addColorStop(.5,'rgba(60,70,80,.05)');gr.addColorStop(1,'rgba(150,170,190,.2)');x.fillStyle=gr;x.fillRect(m,m,n-2*m,n-2*m);
    x.fillStyle='#e9e7e0';x.fillRect(n/2-m*.3,m,m*.6,n-2*m);x.fillRect(m,n/3-m*.3,n-2*m,m*.6);x.fillRect(m,2*n/3-m*.3,n-2*m,m*.6)});
  const winM=new THREE.MeshStandardMaterial({map:winT,roughness:.4,metalness:.1,envMapIntensity:.6,polygonOffset:true,polygonOffsetFactor:-2});
  const tarpBlue=new THREE.MeshStandardMaterial({color:new THREE.Color('#4a5866').convertSRGBToLinear(),roughness:.95,envMapIntensity:.4});
  const tarpGreen=new THREE.MeshStandardMaterial({color:new THREE.Color('#58715f').convertSRGBToLinear(),roughness:.95,side:THREE.DoubleSide,envMapIntensity:.4});
  const fl3=ground(H,4,gravelM);
  [[0,-H-.15,2*H+.6,.3],[0,H+.15,2*H+.6,.3],[-H-.15,0,.3,2*H+.6],[H+.15,0,.3,2*H+.6]].forEach(a=>addBox(a[0],a[1],a[2],a[3],1.7,plankM,1.5));   // cerca
  const WH=3,T=.3,X0=-8,X1=8,Z0=-10,Z1=0,W=X1-X0,D=Z1-Z0;
  // parede do térreo alinhada a um eixo, com aberturas {a,b,k:'p' porta | 'j' janela} medidas ao longo dela
  const wall=(x0,z0,x1,z1,ops,wm)=>{const hz=z0===z1,L=hz?x1-x0:z1-z0,P=(u0,u1,y0,h,col)=>{const c=(u0+u1)/2,w=u1-u0;const x=hz?x0+c:x0,z=hz?z0:z0+c,ww=hz?w:T,dd=hz?T:w;
      if(col&&y0===0)B(x,z,ww,dd,h,wm,2.5);else vis(x,y0,z,ww,h,dd,wm,2.5,true)};
    let u=0;for(const o of ops.sort((p,q)=>p.a-q.a)){if(o.a>u)P(u,o.a,0,WH,true);if(o.k==='j')P(o.a,o.b,0,1,true);P(o.a,o.b,o.k==='p'?2.2:2.1,WH-(o.k==='p'?2.2:2.1));u=o.b}
    if(u<L)P(u,L,0,WH,true)};
  wall(X0,Z1,X1,Z1,[{a:1.6,b:3,k:'j'},{a:4.4,b:5.8,k:'j'},{a:7.3,b:8.7,k:'p'},{a:10.2,b:11.6,k:'j'},{a:13,b:14.4,k:'j'}],sidingM);   // frente: porta no meio e 4 janelas
  wall(X0,Z0,X1,Z0,[{a:3,b:4.4,k:'p'},{a:9,b:10.4,k:'j'},{a:12,b:13.4,k:'j'}],sidingM);                                              // fundos
  wall(X0,Z0,X0,Z1,[{a:3.6,b:5,k:'j'}],sidingM);wall(X1,Z0,X1,Z1,[{a:2.5,b:3.9,k:'j'},{a:6.6,b:8,k:'p'}],sidingM);                 // laterais
  wall(-2,Z0,-2,Z1,[{a:4.4,b:5.8,k:'p'}],plankM);wall(-2,-5,X1,-5,[{a:4.2,b:5.6,k:'p'}],plankM);                                     // cômodos
  const fp=new THREE.Mesh(new THREE.PlaneGeometry(W,D),plankM);fp.rotation.x=-Math.PI/2;fp.position.set(0,.012,(Z0+Z1)/2);fp.receiveShadow=true;MG.add(fp);   // assoalho
  vis(0,WH,(Z0+Z1)/2,W+.3,.2,D+.3,plankM,0,true);                                                                                   // forro / piso do andar de cima
  const U=3.2,y2=WH+.2;                                                                                                              // andar de cima (casca)
  vis(0,y2,Z1-T/2,W,U,T,sidingM,3,true);vis(0,y2,Z0+T/2,W,U,T,sidingM,3,true);vis(X0+T/2,y2,(Z0+Z1)/2,T,U,D,sidingM,3,true);vis(X1-T/2,y2,(Z0+Z1)/2,T,U,D,sidingM,3,true);
  const WPL=new THREE.PlaneGeometry(1,1),win=(x,y,z,ry)=>{const m=new THREE.Mesh(WPL,winM);m.scale.set(1.25,1.6,1);m.position.set(x,y,z);m.rotation.y=ry;MG.add(m)};
  for(const x of[-6.5,-3.5,0,3.5,6.5])win(x,y2+1.7,Z1+.01,0);for(const x of[-5,0,5])win(x,y2+1.7,Z0-.01,Math.PI);
  for(const z of[-7.5,-2.5]){win(X0-.01,y2+1.7,z,-Math.PI/2);win(X1+.01,y2+1.7,z,Math.PI/2)}
  const rise=2.6,roofY=y2+U,half=D/2+.6,sl=Math.hypot(half,rise),ang=Math.atan2(rise,half);                                            // telhado de duas águas
  for(const sd of[1,-1]){const r=new THREE.Mesh(new THREE.BoxGeometry(W+1.2,.14,sl),shingleM);r.position.set(0,roofY+rise/2,(Z0+Z1)/2+sd*half/2);r.rotation.x=sd*ang;r.castShadow=r.receiveShadow=true;MG.add(r);solids.push(r)}
  const gab=new THREE.Shape();gab.moveTo(-D/2,0);gab.lineTo(D/2,0);gab.lineTo(0,rise);gab.closePath();
  for(const x of[X0+.02,X1-.02]){const g=new THREE.Mesh(new THREE.ShapeGeometry(gab),new THREE.MeshStandardMaterial({color:0xdedbd2,roughness:.85,side:THREE.DoubleSide,envMapIntensity:.55}));g.rotation.y=Math.PI/2;g.position.set(x,roofY,(Z0+Z1)/2);g.castShadow=true;MG.add(g)}
  vis(4.5,roofY-.5,-6,.9,rise+1.2,.9,plainCon,0,true);                                                                                // chaminé
  // varanda: piso, colunas, grade com passagem no meio, cobertura e lonas verdes penduradas
  const pz=3.1;vis(0,0,pz/2,W+.4,.12,pz,plankM);
  for(let x=X0;x<=X1+.01;x+=W/5)vis(x,0,pz-.1,.22,2.85,.22,sidingM,0,true);
  for(const [a,b] of[[X0,-1.3],[1.3,X1]])B((a+b)/2,pz-.1,b-a,.1,.95,sidingM,2);B(X0-.1,pz/2,.1,pz,.95,sidingM,2);B(X1+.1,pz/2,.1,pz,.95,sidingM,2);
  vis(0,2.85,pz/2,W+.8,.16,pz+.4,shingleM,0,true);vis(0,0,pz+.35,2.4,.18,.5,plankM);                                               // cobertura e degrau
  for(const x of[-5.2,4.4]){const t=new THREE.Mesh(new THREE.PlaneGeometry(2.6,.85),tarpGreen);t.position.set(x,.5,pz-.02);t.castShadow=true;MG.add(t)}
  // andaime do lado direito: tubos, tábuas no meio da altura e escada
  const sc=[];for(const x of[X1+.8,X1+2.3])for(let z=Z0;z<=Z1+.01;z+=2.5)sc.push(x,z);
  for(let k=0;k<sc.length;k+=2)vis(sc[k],0,sc[k+1],.07,6,.07,poleM);
  vis(X1+1.55,3,(Z0+Z1)/2,1.7,.06,D,plankM);vis(X1+1.55,5.6,(Z0+Z1)/2,1.7,.06,D,plankM);
  const st=new THREE.Mesh(new THREE.BoxGeometry(.9,.08,4.4),plankM);st.position.set(X1+1.55,1.5,-3);st.rotation.x=-.75;st.castShadow=true;MG.add(st);
  // quintal
  [[-2.5,6,3.2,.6,.9],[4,9,3.2,.6,.9],[-9,13,.6,3.2,.9],[13,-12,3.2,.6,.9]].forEach(a=>B(a[0],a[1],a[2],a[3],a[4],plainCon,2));      // blocos de concreto
  B(1.2,5.2,1,1,2.9,plainCon,2);B(8.5,6.8,1,1,3.3,plainCon,2);B(-.4,5.5,2.4,1.4,1.1,plainCon,2);                                    // pilares e bloco grande
  for(const [x,z] of[[3.6,4.6],[4.3,4.9],[-15,-3],[17,4]]){const b=new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.9,12),rustM);b.position.set(x,.45,z);b.castShadow=b.receiveShadow=true;MG.add(b);solids.push(b);boxes.push({minX:x-.3,maxX:x+.3,minZ:z-.3,maxZ:z+.3,h:.9})}
  B(-13.5,8,4.2,1.9,1.2,tarpBlue);const carT=new THREE.Mesh(new THREE.SphereGeometry(1,20,12),tarpBlue);carT.scale.set(2.3,.95,1.05);carT.position.set(-13.5,.55,8);carT.castShadow=true;MG.add(carT);   // carro coberto
  for(let k=0;k<(isTouch?40:90);k++){const r=new THREE.Mesh(lip,plainCon),z0=(Math.random()*2-1)*(H-2),x0=(Math.random()*2-1)*(H-2);if(Math.abs(x0)<9&&z0>-11&&z0<4)continue;   // entulho no chão
    const sz=.12+Math.random()*.35;r.scale.set(sz,sz*.6,sz*(.6+Math.random()));r.position.set(x0,sz*.2,z0);r.rotation.set(Math.random(),Math.random()*3,Math.random());r.castShadow=r.receiveShadow=true;MG.add(r)}
  [[-19,-15],[18,-17],[-21,3],[21,-3],[-19,18]].forEach(p=>tree(p[0],p[1],1+Math.random()*.4,true));treeRing(H);
  mapEnd(2,H,[0,20],[[-18,-6],[18,-8],[0,-20],[-5,-5],[4,-2.5],[-18,16],[18,18],[10,12],[-8,4],[12,-16]],fl3);
  const SUN4=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-36),THREE.MathUtils.degToRad(140));   // casa: dia claro e enevoado
  Object.assign(MAPS[2],{env:skyEnv(SUN4,10,1.6),sunDir:SUN4,sunC:0xfff4e8,sun:PP?2.2:1.8,hemiS:0xe4e8ee,hemiG:0x7a7062,hemi:.55,fog:[new THREE.Color('#d9dbd6').convertSRGBToLinear(),35,170],turb:10,ray:1.6});MAPS[2].flow=true;
  const SUN3=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-34),THREE.MathUtils.degToRad(205));   // trincheira: sol forte, céu limpo (como a foto de referência)
  Object.assign(MAPS[1],{env:skyEnv(SUN3,2.2,1),sunDir:SUN3,sunC:0xfff0dc,sun:PP?2.6:2.1,hemiS:0xd6e4ff,hemiG:0x6a5640,hemi:.38,fog:[new THREE.Color('#b9c4cf').convertSRGBToLinear(),40,190],turb:2.2,ray:1});
  Object.assign(MAPS[0],{env:scene.environment,sunDir:SUN.clone(),sunC:0xffe9cc,sun:sun.intensity,hemiS:0xcfe0ff,hemiG:0x7a6248,hemi:HEMI.intensity,fog:[scene.fog.color.clone(),scene.fog.near,scene.fog.far],turb:2.5,ray:1.2});
  solids.length=0;solids.push(...keepS);boxes.length=0;boxes.push(...keepB);MG=MAP1;
})();
let MAPI=0;
function setMap(i){
  const m=MAPS[i];MAPI=i;MAPG.forEach((g,k)=>g.visible=k===i);
  solids.length=0;solids.push(...m.solids);boxes.length=0;boxes.push(...m.boxes);HALF=m.half;CEIL=m.ceil;
  PICK_PTS.length=0;PICK_PTS.push(...m.pick);
  scene.environment=m.env;scene.fog.color.copy(m.fog[0]);scene.fog.near=m.fog[1];scene.fog.far=m.fog[2];
  if(SKY){const u=SKY.material.uniforms;u.sunPosition.value.copy(m.sunDir);u.turbidity.value=m.turb;u.rayleigh.value=m.ray}
  sun.position.copy(m.sunDir).multiplyScalar(50);sun.color.set(m.sunC);sun.intensity=m.sun;HEMI.color.set(m.hemiS);HEMI.groundColor.set(m.hemiG);HEMI.intensity=m.hemi;
  needReset=true;
}
// campo de direção: BFS numa grade de 1 m a partir do jogador (refeito a cada 0,25 s, só nos mapas com `flow`).
// Inimigo que não enxerga o jogador anda para a célula vizinha mais perto dele: segue as valas e as portas.
const FF={t:0,key:'',n:0,H:0,d:null,wk:null,q:null};
function flowUpdate(dt){const m=MAPS[MAPI];if(!m.flow)return;FF.t-=dt;if(FF.t>0)return;FF.t=.25;
  const H=HALF,n=Math.ceil(2*H),key=MAPI+':'+n;
  if(FF.key!==key){FF.key=key;FF.n=n;FF.H=H;FF.d=new Int16Array(n*n);FF.q=new Int32Array(n*n);FF.wk=new Uint8Array(n*n);
    for(let j=0;j<n;j++)for(let i=0;i<n;i++)FF.wk[j*n+i]=inBox(i-H+.5,j-H+.5,.45)?0:1}
  const d=FF.d,q=FF.q,wk=FF.wk;d.fill(-1);const pi=Math.max(0,Math.min(n-1,Math.floor(P.x+H))),pj=Math.max(0,Math.min(n-1,Math.floor(P.z+H)));
  let h=0,t=0;q[t++]=pj*n+pi;d[pj*n+pi]=0;
  while(h<t){const c=q[h++],i=c%n,j=(c-i)/n;for(const [a,b] of[[1,0],[-1,0],[0,1],[0,-1]]){const x=i+a,y=j+b;if(x<0||y<0||x>=n||y>=n)continue;const k=y*n+x;if(d[k]<0&&wk[k]){d[k]=d[c]+1;q[t++]=k}}}}
function flowDir(x,z){if(!FF.d||FF.key!==MAPI+':'+Math.ceil(2*HALF))return null;const n=FF.n,H=FF.H,i=Math.floor(x+H),j=Math.floor(z+H);
  let best=null,bd=1e9;for(let b=-1;b<=1;b++)for(let a=-1;a<=1;a++){if(!a&&!b)continue;const X=i+a,Y=j+b;if(X<0||Y<0||X>=n||Y>=n)continue;const v=FF.d[Y*n+X];
    if(v>=0&&v<bd&&(!a||!b||(FF.wk[j*n+X]&&FF.wk[Y*n+i]))){bd=v;best=[X-H+.5-x,Y-H+.5-z]}}   // diagonal só se as duas laterais estiverem livres
  if(!best)return null;const l=Math.hypot(best[0],best[1])||1;return[best[0]/l,best[1]/l]}
function seeLine(ax,az,bx,bz){const L=Math.hypot(bx-ax,bz-az),n=Math.ceil(L/.5);for(let k=1;k<n;k++){const t=k/n;if(inBox(ax+(bx-ax)*t,az+(bz-az)*t,.15))return false}return true}
function inBox(x,z,r){for(const o of boxes)if(x>o.minX-r&&x<o.maxX+r&&z>o.minZ-r&&z<o.maxZ+r)return true;return false}

function resolve(p,r){
  for(const o of boxes){
    const cx=Math.max(o.minX,Math.min(p.x,o.maxX)),cz=Math.max(o.minZ,Math.min(p.z,o.maxZ));
    const dx=p.x-cx,dz=p.z-cz,d2=dx*dx+dz*dz;
    if(d2<r*r){
      if(d2>1e-6){const d=Math.sqrt(d2);p.x+=dx/d*(r-d);p.z+=dz/d*(r-d)}
      else p.x=o.minX-r;
    }
  }
  const L=HALF-r;p.x=Math.max(-L,Math.min(L,p.x));p.z=Math.max(-L,Math.min(L,p.z));
}

// arma em primeira pessoa: mãos com luva e manga, arma montada peça por peça em makeGun()
const gun=new THREE.Group();
const wm=new THREE.Group();gun.add(wm);
const GM={
  metal:new THREE.MeshStandardMaterial({color:0x2e3034,metalness:.85,roughness:.32,envMapIntensity:.25}),
  dark:new THREE.MeshStandardMaterial({color:0x161719,metalness:.6,roughness:.42,envMapIntensity:.18}),
  poly:new THREE.MeshStandardMaterial({color:0x1e1f21,metalness:.05,roughness:.66,envMapIntensity:.12}),
  tan:new THREE.MeshStandardMaterial({color:0x8a7656,metalness:.05,roughness:.7,envMapIntensity:.2}),
  wood:new THREE.MeshStandardMaterial({color:0x6e3d1c,metalness:0,roughness:.5,envMapIntensity:.25}),
  lens:new THREE.MeshStandardMaterial({color:0x1d3550,metalness:.9,roughness:.06,envMapIntensity:.6}),
  steel:new THREE.MeshStandardMaterial({color:0xc9ced4,metalness:1,roughness:.2,envMapIntensity:.45}),
  bore:new THREE.MeshBasicMaterial({color:0x050505})
};
let VMY=0;   // pistolas ficam um pouco mais altas para as mãos aparecerem
const sl=new THREE.MeshStandardMaterial({color:0x4a4936,roughness:.92,envMapIntensity:.2}),gl=new THREE.MeshStandardMaterial({color:0x1c1d1f,roughness:.75,envMapIntensity:.15});
const BOX=new THREE.BoxGeometry(1,1,1),CYL=new THREE.CylinderGeometry(1,1,1,16),SPH=new THREE.SphereGeometry(1,16,12);CYL.rotateX(Math.PI/2);
// mãos: palma + 4 dedos fechados em volta do cabo (eixo y da mão) + polegar; a esquerda é espelhada (scale.x=-1)
function makeHand(){
  const h=new THREE.Group(),add=(geo,s,x,y,z,rx,ry,rz)=>{const o=new THREE.Mesh(geo,gl);o.scale.set(s[0],s[1],s[2]);o.position.set(x,y,z);o.rotation.set(rx||0,ry||0,rz||0);h.add(o);return o};
  add(SPH,[.022,.05,.04],.03,-.005,.008);                                  // dorso da mão (lado de fora do cabo)
  for(let i=0;i<4;i++){add(CYL,[.0105,.0105,.046],.002,.026-i*.02,-.03,0,Math.PI/2);add(SPH,[.0115,.0115,.0115],-.022,.026-i*.02,-.024)} // dedos e pontas
  add(CYL,[.011,.011,.04],-.02,.032,.006,-.6,.4);                           // polegar
  add(CYL,[.036,.036,.05],.02,-.06,.03,1.25);                               // punho da luva
  return h;
}
const hR=makeHand(),hL=makeHand();hL.scale.x=-1;gun.add(hR,hL);
const fR=new THREE.Mesh(CYL,sl),fL=new THREE.Mesh(CYL,sl);gun.add(fR,fL);
// antebraço: cilindro do pulso até um cotovelo fixo fora da tela, recalculado a cada quadro
const ER=new THREE.Vector3(.2,-.55,.22),EL=new THREE.Vector3(-.3,-.5,0),_w=new THREE.Vector3(),_d=new THREE.Vector3(),ZA=new THREE.Vector3(0,0,1);
function arm(h,f,E){h.updateMatrix();_w.set(.02,-.075,.04).applyMatrix4(h.matrix);_d.subVectors(E,_w);const L=_d.length();f.position.copy(_w).addScaledVector(_d,.5);f.quaternion.setFromUnitVectors(ZA,_d.normalize());f.scale.set(.042,.042,L);f.visible=h.visible}
function arms(){arm(hR,fR,ER);arm(hL,fL,EL)}
// ---------- efeitos de tiro (texturas desenhadas em canvas, luz somada: o bloom faz o brilho) ----------
function fxTex(n,draw){const c=document.createElement('canvas');c.width=c.height=n;draw(c.getContext('2d'),n);const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;return t}
const TX_STAR=fxTex(128,(x,n)=>{const h=n/2;x.translate(h,h);                       // clarão de frente: estrela de 7 pontas irregulares
  for(let i=0;i<7;i++){x.rotate(Math.PI*2/7);const L=h*(.6+Math.random()*.4),g=x.createLinearGradient(0,0,L,0);
    g.addColorStop(0,'rgba(255,245,210,1)');g.addColorStop(.5,'rgba(255,170,60,.7)');g.addColorStop(1,'rgba(255,110,20,0)');
    x.fillStyle=g;x.beginPath();x.moveTo(0,-h*.09);x.lineTo(L,0);x.lineTo(0,h*.09);x.fill()}
  const r=x.createRadialGradient(0,0,0,0,0,h*.42);r.addColorStop(0,'rgba(255,255,240,1)');r.addColorStop(.35,'rgba(255,210,120,.9)');r.addColorStop(1,'rgba(255,120,30,0)');
  x.fillStyle=r;x.beginPath();x.arc(0,0,h*.42,0,7);x.fill()});
const TX_PLUME=fxTex(128,(x,n)=>{for(let i=0;i<5;i++){const y=n/2+(Math.random()-.5)*n*.25,L=n*(.55+Math.random()*.45),w=n*(.06+Math.random()*.08);   // labareda de lado (sai da esquerda)
  const g=x.createLinearGradient(0,0,L,0);g.addColorStop(0,'rgba(255,240,200,.95)');g.addColorStop(.4,'rgba(255,160,50,.6)');g.addColorStop(1,'rgba(255,90,10,0)');
  x.fillStyle=g;x.beginPath();x.moveTo(0,y-w);x.quadraticCurveTo(L*.5,y-w*1.4,L,y);x.quadraticCurveTo(L*.5,y+w*1.4,0,y+w);x.fill()}});
const TX_GLOW=fxTex(64,(x,n)=>{const g=x.createRadialGradient(n/2,n/2,0,n/2,n/2,n/2);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.3,'rgba(255,255,255,.5)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,n,n)});
const TX_TRACE=fxTex(128,(x,n)=>{const g=x.createLinearGradient(0,0,n,0);g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(.85,'rgba(255,255,255,.8)');g.addColorStop(1,'rgba(255,255,255,1)');   // cauda → cabeça
  x.fillStyle=g;x.fillRect(0,0,n,n);x.globalCompositeOperation='destination-in';const v=x.createLinearGradient(0,0,0,n);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(.5,'rgba(0,0,0,1)');v.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=v;x.fillRect(0,0,n,n)});
const TX_SMOKE=fxTex(64,(x,n)=>{for(let i=0;i<9;i++){const cx=n/2+(Math.random()-.5)*n*.35,cy=n/2+(Math.random()-.5)*n*.35,r=n*(.18+Math.random()*.16),g=x.createRadialGradient(cx,cy,0,cx,cy,r);
  g.addColorStop(0,'rgba(255,255,255,.35)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,n,n)}});
const TX_HOLE=fxTex(64,(x,n)=>{const h=n/2;for(let i=0;i<14;i++){const a=Math.random()*6.28,d=h*(.2+Math.random()*.45),r=h*(.12+Math.random()*.2);   // lascas em volta
  x.fillStyle='rgba(40,36,32,'+(.25+Math.random()*.3)+')';x.beginPath();x.arc(h+Math.cos(a)*d,h+Math.sin(a)*d,r,0,7);x.fill()}
  const g=x.createRadialGradient(h,h,0,h,h,h*.34);g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(.7,'rgba(10,8,6,.95)');g.addColorStop(1,'rgba(30,26,22,0)');x.fillStyle=g;x.beginPath();x.arc(h,h,h*.34,0,7);x.fill()});
const addM=(map,c,o)=>new THREE.MeshBasicMaterial({map,color:new THREE.Color(c).multiplyScalar(PP?2.4:1),transparent:true,opacity:o||1,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
const M_STAR=addM(TX_STAR,0xffffff),M_PLUME=addM(TX_PLUME,0xffffff),M_TRACE=addM(TX_TRACE,0xffd27a,.9),M_SPARK=addM(TX_GLOW,0xffc060),PLANE=new THREE.PlaneGeometry(1,1);
const M_EFLASH=new THREE.SpriteMaterial({map:TX_STAR,color:new THREE.Color(0xffffff).multiplyScalar(PP?2.4:1),blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,toneMapped:false});
// clarão: estrela de frente + duas labaredas cruzadas ao longo do cano (eixo -z)
function makeFlash(){const g=new THREE.Group(),st=new THREE.Mesh(PLANE,M_STAR);st.scale.setScalar(.2);g.add(st);
  for(let i=0;i<2;i++){const w=new THREE.Group(),pl=new THREE.Mesh(PLANE,M_PLUME);w.rotation.z=i*Math.PI/2;pl.rotation.y=Math.PI/2;pl.scale.set(.34,.13,1);pl.position.z=-.15;w.add(pl);g.add(w)}
  return g}
// traçante: dois planos cruzados com a textura cauda→cabeça; o grupo olha para onde a bala vai (cabeça no z=0, cauda para trás)
function makeTracer(len,w){const g=new THREE.Group();for(let i=0;i<2;i++){const r=new THREE.Group(),m=new THREE.Mesh(PLANE,M_TRACE);r.rotation.z=i*Math.PI/2;m.rotation.y=Math.PI/2;m.scale.set(len,w,1);m.position.z=-len/2;r.add(m);g.add(r)}return g}
const tracers=[],sparksL=[],shells=[],eflashes=[];
function tracer(from,to,speed){const d=to.clone().sub(from),L=d.length();if(L<.5)return;const g=makeTracer(Math.min(3,L*.5),.012);
  g.position.copy(from);g.lookAt(to);scene.add(g);tracers.push({g,from:from.clone(),dir:d.normalize(),L,t:0,sp:speed})}
function sparks(pos,dir,n,spd){for(let i=0;i<n;i++){const m=new THREE.Mesh(PLANE,M_SPARK),v=(dir?dir.clone():new THREE.Vector3(0,1,0)).add(new THREE.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).multiplyScalar(1.4)).normalize().multiplyScalar((spd||5)*(.4+Math.random()));
  m.position.copy(pos);scene.add(m);sparksL.push({m,v,life:.12+Math.random()*.18})}}
const CASE_G=new THREE.CylinderGeometry(.0045,.0045,.024,8),CASE_M=new THREE.MeshStandardMaterial({color:0xc9a43a,metalness:.95,roughness:.28,envMapIntensity:.6});
function ejectShell(pos,right,up,big){const m=new THREE.Mesh(CASE_G,CASE_M);m.position.copy(pos);if(big)m.scale.set(1.3,1.5,1.3);m.castShadow=true;scene.add(m);
  const v=right.clone().multiplyScalar(1.6+Math.random()*.8).addScaledVector(up,1.2+Math.random()*.8);shells.push({m,v,w:new THREE.Vector3(Math.random()*20,Math.random()*20,Math.random()*20),t:0,b:0});
  if(shells.length>40)scene.remove(shells.shift().m)}
function eflash(pos,dir){const s=new THREE.Sprite(M_EFLASH);s.position.copy(pos).addScaledVector(dir,.06);s.scale.setScalar(.35+Math.random()*.15);scene.add(s);eflashes.push({m:s,life:.05})}
function updateShots(dt){
  for(let i=tracers.length-1;i>=0;i--){const t=tracers[i];t.t+=dt;const head=t.t*t.sp;t.g.position.copy(t.from).addScaledVector(t.dir,Math.min(head,t.L));
    if(head-3>t.L){scene.remove(t.g);tracers.splice(i,1)}}
  for(let i=sparksL.length-1;i>=0;i--){const k=sparksL[i];k.life-=dt;k.v.y-=9*dt;k.m.position.addScaledVector(k.v,dt);k.m.quaternion.copy(camera.quaternion);   // de frente para a câmera
    const sp=k.v.length();k.m.scale.set(.012,Math.min(.09,.006+sp*.012),1);if(k.life<=0){scene.remove(k.m);sparksL.splice(i,1)}}
  for(let i=shells.length-1;i>=0;i--){const c=shells[i],p=c.m.position;c.t+=dt;
    if(!c.rest){c.v.y-=9.8*dt;p.addScaledVector(c.v,dt);c.m.rotation.x+=c.w.x*dt;c.m.rotation.y+=c.w.y*dt;c.m.rotation.z+=c.w.z*dt;
      if(p.y<.0045){p.y=.0045;if(Math.abs(c.v.y)<.6){c.rest=true;c.m.rotation.set(0,c.m.rotation.y,Math.PI/2)}else{c.v.y=-c.v.y*.35;c.v.x*=.5;c.v.z*=.5;c.w.multiplyScalar(.6);
        if(c.b++<2&&Math.hypot(p.x-P.x,p.z-P.z)<6){const f=3000+Math.random()*1200,v=.02/(c.b);tn({f,v,d:.18});tn({f:f*1.47,v:v*.6,d:.12})}}}}   // tilintar no chão
    if(c.t>6){scene.remove(c.m);shells.splice(i,1)}}
  for(let i=eflashes.length-1;i>=0;i--){const f=eflashes[i];f.life-=dt;if(f.life<=0){scene.remove(f.m);eflashes.splice(i,1)}}
}
// ---------- sangue: névoa na direção da bala, gotas esticadas que caem e mancham o chão ----------
const BC=PP?2.2:1;   // com PP a cor passa pela exposição do grade: compensa para não virar preto
const TX_SPLAT=[0,1,2].map(()=>fxTex(128,(x,n)=>{const h=n/2,R=()=>Math.random(),dot=(a,d,r)=>{x.beginPath();x.arc(h+Math.cos(a)*d,h+Math.sin(a)*d,r,0,7);x.fill()};
  x.fillStyle=x.strokeStyle='rgba(120,10,10,.92)';x.lineCap='round';
  for(let i=0;i<9;i++)dot(R()*6.28,R()*h*.22,h*(.1+R()*.16));                       // poça irregular
  for(let i=0;i<8;i++){const a=R()*6.28,L=h*(.45+R()*.45);x.lineWidth=h*(.02+R()*.035);x.beginPath();x.moveTo(h+Math.cos(a)*h*.2,h+Math.sin(a)*h*.2);x.lineTo(h+Math.cos(a)*L,h+Math.sin(a)*L);x.stroke();dot(a,L,h*(.03+R()*.03))}   // raios com gota na ponta
  for(let i=0;i<24;i++)dot(R()*6.28,h*(.3+R()*.6),h*(.012+R()*.04))}));            // respingos soltos
const SPLAT_M=TX_SPLAT.map(t=>new THREE.MeshBasicMaterial({map:t,color:new THREE.Color(.75,.6,.6).multiplyScalar(BC*.6),transparent:true,opacity:.9,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3}));
const DROP_M=new THREE.MeshBasicMaterial({map:TX_GLOW,color:new THREE.Color(0x7a0808).multiplyScalar(BC),transparent:true,depthWrite:false,side:THREE.DoubleSide});
const bloodL=[],splats=[];
// ferimento de bala no corpo: furo escuro com mancha irregular de sangue, preso ao osso atingido (acompanha a animação e o
// ragdoll, e fica no cadáver). As caixas de acerto são maiores que o corpo: o decalque entra um pouco na direção do tiro.
const TX_WOUND=[0,1,2].map(()=>fxTex(64,(x,n)=>{const h=n/2,R=()=>Math.random();
  for(let i=0;i<9;i++){const a=R()*6.28,d=R()*h*.35,r=h*(.18+R()*.22),g=x.createRadialGradient(h+Math.cos(a)*d,h+Math.sin(a)*d,0,h+Math.cos(a)*d,h+Math.sin(a)*d,r);
    g.addColorStop(0,'rgba(130,8,10,.9)');g.addColorStop(1,'rgba(90,5,7,0)');x.fillStyle=g;x.fillRect(0,0,n,n)}
  for(let i=0;i<10;i++){const a=R()*6.28,d=h*(.35+R()*.45);x.fillStyle='rgba(80,5,7,.8)';x.beginPath();x.arc(h+Math.cos(a)*d,h+Math.sin(a)*d,h*(.03+R()*.05),0,7);x.fill()}
  const c=x.createRadialGradient(h,h,0,h,h,h*.22);c.addColorStop(0,'rgba(8,2,2,1)');c.addColorStop(.7,'rgba(40,3,4,.95)');c.addColorStop(1,'rgba(60,4,6,0)');
  x.fillStyle=c;x.beginPath();x.arc(h,h,h*.22,0,7);x.fill()}));
const WOUND_M=TX_WOUND.map(t=>new THREE.MeshBasicMaterial({map:t,color:new THREE.Color(1,1,1).multiplyScalar(BC),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,side:THREE.DoubleSide}));
const WOUND_G=new THREE.PlaneGeometry(1,1),_wn=new THREE.Vector3();
function wound(hit,dir){
  const o=hit.object,e=o.userData.owner,par=o.userData.hb?o.parent:o;if(!e||!par)return;   // caixa de acerto: preso ao osso (a caixa tem escala esticada)
  const m=new THREE.Mesh(WOUND_G,WOUND_M[Math.random()*3|0]);
  if(hit.face)_wn.copy(hit.face.normal).transformDirection(o.matrixWorld);else _wn.copy(dir).negate();
  m.position.copy(hit.point).addScaledVector(dir,o.userData.hb?(o.userData.head?.03:.045):.002);
  m.lookAt(m.position.clone().add(_wn));m.rotateZ(Math.random()*6.28);m.scale.setScalar(.1+Math.random()*.05);
  scene.add(m);par.attach(m);(e.wounds||(e.wounds=[])).push(m);if(e.wounds.length>12){const w=e.wounds.shift();if(w.parent)w.parent.remove(w)}
}
function splat(x,z,s){const m=new THREE.Mesh(PLANE,SPLAT_M[Math.random()*3|0].clone());m.rotation.set(-Math.PI/2,0,Math.random()*6.28);m.position.set(x,.012+splats.length*1e-5,z);m.scale.setScalar(s);scene.add(m);
  splats.push({m,t:0});if(splats.length>40){const o=splats.shift();scene.remove(o.m);o.m.material.dispose()}}
// k: intensidade (1 tiro comum, ~2.5 headshot)
function bloodFx(p,dir,k){
  for(let i=0;i<2;i++){const m=new THREE.Sprite(new THREE.SpriteMaterial({map:TX_SMOKE,color:new THREE.Color(i?0x3a0404:0x5a0606).multiplyScalar(BC*.8),transparent:true,depthWrite:false,rotation:Math.random()*6.28}));   // névoa
    m.position.copy(p).addScaledVector(dir,.05+i*.12);scene.add(m);bloodL.push({m,mist:1,v:dir.clone().multiplyScalar(1.2+i),t:0,max:.28+i*.12,s:(.22+i*.14)*k})}
  for(let i=0,n=Math.round(7*k);i<n;i++){const m=new THREE.Mesh(PLANE,DROP_M);m.position.copy(p);scene.add(m);   // gotas
    const v=dir.clone().multiplyScalar(1.5+Math.random()*3.5).add(new THREE.Vector3(Math.random()-.5,Math.random()*.8,Math.random()-.5).multiplyScalar(2.4));
    bloodL.push({m,v,t:0,max:1.5,s:.012+Math.random()*.014})}
}
function updateBlood(dt){
  for(let i=bloodL.length-1;i>=0;i--){const b=bloodL[i],p=b.m.position;b.t+=dt;
    if(b.mist){const k=b.t/b.max;b.m.scale.setScalar(b.s*(.6+k*.9));b.m.material.opacity=.85*(1-k*k);p.addScaledVector(b.v,dt);b.v.multiplyScalar(Math.exp(-dt*6))}
    else{b.v.y-=9.8*dt;p.addScaledVector(b.v,dt);b.m.quaternion.copy(camera.quaternion);b.m.scale.set(b.s,b.s+Math.min(.07,b.v.length()*.008),1);   // de frente para a câmera, esticada pela velocidade
      if(p.y<.02){if(Math.random()<.5)splat(p.x,p.z,.12+Math.random()*.2);b.t=b.max}}
    if(b.t>=b.max){scene.remove(b.m);if(b.mist)b.m.material.dispose();bloodL.splice(i,1)}}
  for(const s of splats){s.t+=dt;if(s.t>20)s.m.material.opacity=.9*Math.max(0,1-(s.t-20)/5)}   // manchas somem devagar depois de 20 s
  while(splats.length&&splats[0].t>25){const o=splats.shift();scene.remove(o.m);o.m.material.dispose()}
}
const flash=makeFlash();
flash.position.set(0,.03,-.5);flash.visible=false;gun.add(flash);
const mlight=new THREE.PointLight(0xffa24a,0,9);mlight.position.set(0,.05,-.7);gun.add(mlight);
let mag=new THREE.Object3D();
gun.position.set(.26,-.24,-.5);camera.add(gun);

// ---------- estado ----------
let MAG=15,RL=1.1;
const P={x:0,y:0,z:22,vy:0};
let yaw=0,pitch=0,hp=100,ammo=MAG,reserve=45,score=0,wave=0,wt=0,spawning=false,moveAmt=0,stepT=0;
let armor=0,gren=0,grenCD=0;const GMAX=3,GR=6;
let scopeLv=0,ads=false,adsK=0,crouch=false,crK=0,spK=0,swing=0,prevSlot=2,gHold=-1,cur=2,money=800,bestW=0,contW=0,contS=0,wantCont=false,cw=null,own={glock:1,knife:1},st={},eq={1:null,2:'glock',3:'knife'};
// ---------- armas ----------
const WP={};
[
['glock','Glock-18','p',2,0,10,.15,15,60,1.1,.004,0,1,[.2,.08,.1,0,0,0]],
['usp','USP','p',2,200,12,.17,12,48,1.1,.003,0,1,[.22,.1,.09,0,0,0]],
['dual','Berettas Duplas','p',2,300,9,.1,30,90,2.2,.012,0,1,[.18,.07,.08,0,0,0],0,0,1],
['p250','P250','p',2,300,15,.2,13,52,1.3,.004,0,1,[.22,.1,.1,0,0,0]],
['five','Five-SeveN','p',2,400,14,.16,20,80,1.4,.004,0,1,[.22,.1,.1,0,0,0]],
['tec9','Tec-9','p',2,500,11,.09,32,96,1.6,.014,1,1,[.24,.12,.16,0,0,0]],
['deagle','Desert Eagle','p',2,700,38,.5,7,35,1.6,.006,0,1,[.28,.12,.09,0,0,0]],
['nova','Nova','i',1,1200,9,.9,8,32,2.6,.03,0,8,[.3,.4,.01,0,1,1]],
['xm','XM1014','i',1,2000,7,.35,7,32,2.8,.035,0,6,[.34,.4,.01,0,1,0]],
['mac10','MAC-10','i',1,1050,10,.07,30,90,1.8,.014,1,1,[.24,.14,.2,0,1,0]],
['mp9','MP9','i',1,1250,11,.07,30,100,1.8,.01,1,1,[.26,.12,.2,0,1,0]],
['mp5','MP5-SD','i',1,1500,12,.075,30,120,2,.008,1,1,[.3,.22,.18,0,1,0],.12],
['p90','P90','i',1,2350,11,.065,50,150,2.3,.01,1,1,[.36,.08,.06,0,0,0]],
['galil','Galil AR','r',1,2000,18,.09,35,90,2.3,.008,1,1,[.34,.3,.2,0,1,0]],
['famas','FAMAS','r',1,2250,17,.08,25,90,2.2,.007,1,1,[.36,.28,.18,0,0,0]],
['ak','AK-47','r',1,2500,25,.1,30,90,2.4,.007,1,1,[.36,.34,.24,0,1,0]],
['m4','M4A1','r',1,3100,22,.09,30,90,2.2,.005,1,1,[.36,.34,.2,0,1,0]],
['m4s','M4A1-S','r',1,3300,20,.09,20,80,2.2,.004,1,1,[.36,.4,.18,0,1,0],.12],
['sg','SG 553','r',1,3000,24,.1,30,90,2.3,.005,1,1,[.36,.32,.22,1,1,0]],
['aug','AUG','r',1,3300,22,.09,30,90,2.3,.005,1,1,[.4,.3,.2,1,0,0]],
['ssg','SSG 08','r',1,1700,85,1.1,10,90,2.5,.001,0,1,[.42,.5,.1,1,1,0]],
['awp','AWP','r',1,4750,120,1.5,5,20,3,.0008,0,1,[.42,.55,.12,1,1,0]],
['apx','APX A1','p',2,450,13,.15,17,68,1.2,.004,0,1,[.22,.1,.1,0,0,0]],
['bizon','PP-19 Bizon','i',1,1400,11,.075,64,128,2.4,.012,1,1,[.36,.2,.06,0,1,0]],
['pmx','PMX','i',1,1700,12,.07,30,120,2,.009,1,1,[.3,.22,.18,0,1,0]],
['ak12','AK-12','r',1,2900,24,.095,30,90,2.3,.006,1,1,[.36,.34,.22,1,1,0]],
['fuzil','Fuzil tático','r',1,3200,23,.09,30,90,2.3,.005,1,1,[.36,.34,.2,1,1,0]]
].forEach(a=>{const w=WP[a[0]]={id:a[0],name:a[1],cat:a[2],slot:a[3],price:a[4],dmg:a[5],cd:a[6],mag:a[7],res:a[8],rl:a[9],sp:a[10],auto:a[11],n:a[12],g:a[13],q:a[14]||.4,c:a[15]||0,x2:a[16]||0};w.rc=Math.min(.06,.004+w.dmg*.0004+(w.n>1?.02:0));w.sc=w.sp<=.001&&!w.auto});   // sc: tem luneta
WP.knife={id:'knife',name:'Faca',cat:'k',slot:3,price:0,dmg:35,cd:.5,mag:0,res:0,rl:1,sp:0,auto:1,n:1,g:[0,0,0,0,0,0],q:.4,c:0,x2:0,k:1,rc:0};
// lâmina da faca (perfil extrudado)
const KB=(()=>{const s=new THREE.Shape();s.moveTo(0,-.013);s.lineTo(.2,-.013);s.quadraticCurveTo(.27,-.01,.3,.02);s.lineTo(.22,.024);s.lineTo(0,.022);s.lineTo(0,-.013);
  const g=new THREE.ExtrudeGeometry(s,{depth:.003,bevelEnabled:true,bevelThickness:.0025,bevelSize:.002,bevelSegments:1});g.translate(0,0,-.0015);g.rotateY(Math.PI/2);return g})();
// monta a arma dentro de `par` (eixo -z = frente). Devolve o carregador (some na recarga) e a posição z da boca do cano.
// ---------- armas 3D (modelos em assets/armas) ----------
// Cada modelo é girado (rot), escalado para `len` metros e posicionado no padrão do makeGun: frente em -z, fundo em z=back,
// topo em y=top. Cabo e apoio da mão esquerda são frações do comprimento (gF/fF) e da altura (gY/fY).
// Enquanto o modelo não carrega (ou se falhar), a arma procedural continua valendo.
const MDL={
  ak:{f:'ak47_counter_strike_2',len:.74,back:.34,gF:.35,fF:.62,flip:1,mag:{z:[-.105,.022],y:-.03}},
  ak12:{f:'ak12',len:.74,back:.34,gF:.35,fF:.62,tint:0x26272a,flip:1,mag:{z:[-.053,.053],y:-.035}},
  bizon:{f:'bizon',len:.62,back:.3,gF:.33,fF:.6,tint:0x2a2b2d,flip:1,drop:/^pp19dc/,mag:{n:/^pp19mag/}},
  pmx:{f:'pmx',len:.52,back:.26,gF:.4,fF:.63,flip:1,mag:{z:[-.125,-.075],y:-.09}},
  fuzil:{f:'gun',len:.78,back:.34,gF:.33,fF:.6,mag:{z:[-.1,-.005],y:-.045}},
  apx:{f:'apx',len:.2,back:.12,gF:.22,pistol:1,flip:1},
  glock:{f:'glock',len:.19,back:.12,gF:.22,pistol:1,rot:[0,Math.PI/2,0],flip:1},   // modelo vem com o comprimento em x
  deagle:{f:'deagle',len:.27,back:.12,gF:.2,pistol:1,flip:1},
  awp:{f:'awp',len:.95,back:.36,gF:.3,fF:.55,flip:1,mag:{z:[-.005,.055],y:-.07}},
  dual:{f:'beretta',len:.2,back:.12,gF:.22,pistol:1,flip:1}
};
// só as armas com modelo 3D (e a faca) ficam no jogo
for(const id in WP)if(!MDL[id]&&!WP[id].k)delete WP[id];
WP.gren={id:'gren',name:'Granada',cat:'k',slot:4,price:0,dmg:0,cd:.5,mag:0,res:0,rl:1,sp:0,auto:0,n:1,g:[0,0,0,0,0,0],q:.4,c:0,x2:0,k:1,gr:1,rc:0};   // granada na mão (tecla 4); não fica no inventário nem na loja
function loadWeapons(){
  if(!THREE.GLTFLoader||location.protocol==='file:')return;
  const L=new THREE.GLTFLoader();
  L.load('assets/armas/grenade.glb',g=>{const o=g.scene,b=new THREE.Box3().setFromObject(o),s=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3());   // granada: ~14 cm, centrada
    const k=.14/Math.max(s.x,s.y,s.z);o.scale.setScalar(k);o.position.copy(c).multiplyScalar(-k);o.traverse(m=>{if(m.isMesh){m.castShadow=true;m.material.envMapIntensity=.3}});
    GTPL=new THREE.Group();GTPL.add(o)},undefined,e=>console.warn('granada 3D',e));
  for(const id in MDL)L.load('assets/armas/'+MDL[id].f+'.glb',g=>{try{prepWeapon(MDL[id],g.scene);if(cw&&cw.id===id)buildGun(cw)}catch(e){console.warn('arma 3D',id,e)}},undefined,e=>console.warn('arma 3D',id,e));
}
function prepWeapon(m,obj){
  const wrap=new THREE.Group(),inner=new THREE.Group();inner.add(obj);wrap.add(inner);
  if(m.rot)inner.rotation.set(m.rot[0],m.rot[1],m.rot[2]);
  if(m.flip)inner.rotation.y+=Math.PI;
  const box=()=>{wrap.updateMatrixWorld(true);return new THREE.Box3().setFromObject(wrap)};
  if(m.drop){const rm=[];obj.traverse(o=>{if(o.isMesh&&m.drop.test(o.name))rm.push(o)});rm.forEach(o=>o.parent.remove(o))}   // peças fora do lugar no modelo original
  let b=box(),s=b.getSize(new THREE.Vector3());inner.scale.multiplyScalar(m.len/s.z);
  b=box();s=b.getSize(new THREE.Vector3());
  const top=m.pistol?.047:.045;
  inner.position.set(-(b.min.x+b.max.x)/2,top-b.max.y,m.back-b.max.z);
  obj.traverse(o=>{if(o.isMesh){o.castShadow=true;if(m.tint)o.material=new THREE.MeshStandardMaterial({color:m.tint,metalness:.6,roughness:.45,envMapIntensity:.25});
    else[].concat(o.material).forEach(x=>{x.envMapIntensity=.35})}});
  const h=s.y,L=m.len,bk=m.back;
  m.grip=new THREE.Vector3(0,top-h*(m.gY||(m.pistol?.62:.55)),bk-L*m.gF);
  m.fore=m.pistol?new THREE.Vector3(-.026,m.grip.y-.016,m.grip.z+.008):new THREE.Vector3(0,top-h*(m.fY||.35),bk-L*m.fF);
  m.muzzle=bk-L;m.tpl=wrap;
  makeMag(m,wrap,obj,b);
}
// pente separado do modelo, para a recarga tirar e colocar: nos fuzis, os triângulos dentro da caixa m.mag (ou as malhas
// com o nome m.mag.n) viram o grupo 'pente'; nas pistolas, um pente simples dentro do cabo, que só aparece ao sair por baixo
function makeMag(m,wrap,obj,b){
  const pg=new THREE.Group();pg.name='pente';wrap.updateMatrixWorld(true);
  if(m.pistol){b=new THREE.Box3().setFromObject(obj);const top=b.min.y+.1,o=new THREE.Mesh(BOX,GM.dark);o.scale.set(.02,top-b.min.y-.003,.028);
    pg.position.set(m.grip.x,top,m.grip.z);o.position.y=-(top-b.min.y)/2;pg.userData.grab=new THREE.Vector3(0,b.min.y-top+.02,0);wrap.add(pg);pg.add(o);return}
  if(!m.mag)return;
  const M=new THREE.Matrix4(),v=new THREE.Vector3(),w=new THREE.Vector3(),parts=[],got=[],q=m.mag,bb=new THREE.Box3(),pts=[];
  obj.traverse(o=>{if(o.isMesh)parts.push(o)});
  for(const o of parts){
    if(q.n){if(q.n.test(o.name)){got.push(o);bb.expandByObject(o)}continue}
    M.copy(o.matrixWorld);const g=o.geometry,P=g.attributes.position,ix=g.index?g.index.array:null,N=ix?ix.length:P.count;
    const grs=g.groups.length?g.groups:[{start:0,count:N,materialIndex:0}],A=[],B=[],gA=[],gB=[];
    const inBox=(a,c,d)=>{w.fromBufferAttribute(P,a).add(v.fromBufferAttribute(P,c)).add(v.fromBufferAttribute(P,d)).multiplyScalar(1/3).applyMatrix4(M);
      const r=w.y<q.y&&w.z>q.z[0]&&w.z<q.z[1];if(r)for(const k of [a,c,d]){v.fromBufferAttribute(P,k).applyMatrix4(M);bb.expandByPoint(v);if(pts.length<6e4)pts.push(v.clone())}return r};
    for(const gr of grs){const sa=A.length,sb=B.length;
      for(let i=gr.start;i<gr.start+gr.count;i+=3){const a=ix?ix[i]:i,c=ix?ix[i+1]:i+1,d=ix?ix[i+2]:i+2;(inBox(a,c,d)?B:A).push(a,c,d)}
      gA.push({start:sa,count:A.length-sa,materialIndex:gr.materialIndex});gB.push({start:sb,count:B.length-sb,materialIndex:gr.materialIndex})}
    if(!B.length)continue;
    const mk=(arr,gs)=>{const ng=new THREE.BufferGeometry();for(const k in g.attributes)ng.setAttribute(k,g.attributes[k]);   // atributos compartilhados: só o índice muda
      ng.setIndex(new THREE.BufferAttribute(P.count>65535?new Uint32Array(arr):new Uint16Array(arr),1));
      if(g.groups.length)gs.forEach(x=>{if(x.count)ng.addGroup(x.start,x.count,x.materialIndex)});return ng};
    o.geometry=mk(A,gA);const c=new THREE.Mesh(mk(B,gB),o.material);c.castShadow=true;
    c.position.copy(o.position);c.quaternion.copy(o.quaternion);c.scale.copy(o.scale);o.parent.add(c);got.push(c);
  }
  if(!got.length)return;
  bb.applyMatrix4(new THREE.Matrix4().copy(wrap.matrixWorld).invert());   // caixa só dos triângulos do pente (a geometria é compartilhada)
  pg.position.set((bb.min.x+bb.max.x)/2,bb.max.y,(bb.min.z+bb.max.z)/2);wrap.add(pg);pg.updateMatrixWorld(true);   // origem do pente: topo, no centro
  const lo=pts.filter(p=>p.y<bb.min.y+(bb.max.y-bb.min.y)*.45),gc=new THREE.Vector3();lo.forEach(p=>gc.add(p));   // onde a mão pega: centro da metade de baixo
  pg.userData.grab=lo.length?gc.multiplyScalar(1/lo.length).sub(pg.position):new THREE.Vector3(0,-.1,0);
  got.forEach(c=>pg.attach(c));
}
function makeGun(w,par,proc){
  const md=!proc&&MDL[w.id];
  if(md&&md.tpl){const t=md.tpl.clone();par.add(t);return {mag:t.getObjectByName('pente')||new THREE.Object3D(),muzzle:md.muzzle,grip:md.grip.clone(),gRot:md.pistol?.28:.3,fore:md.fore.clone(),fRot:md.pistol?.28:-1.45}}
  const id=w.id,g=w.g,L=g[0],B=g[1],M=g[2],sup=w.q<.2,shot=w.n>1;
  const bx=(sx,sy,sz,m,x,y,z,rx)=>{const o=new THREE.Mesh(BOX,m);o.scale.set(sx,sy,sz);o.position.set(x,y,z);o.rotation.x=rx||0;par.add(o);return o};
  const cy=(r,len,m,x,y,z)=>{const o=new THREE.Mesh(CYL,m);o.scale.set(r,r,len);o.position.set(x,y,z);par.add(o);return o};
  let magM,muzzle,grip,gRot,fore,fRot;
  if(w.cat==='p'){                                                   // ---- pistolas
    const fr=id==='tec9'||id==='deagle'?GM.metal:GM.poly,sd=id==='deagle'?GM.steel:GM.dark,gz=.075;
    bx(.05,.05,L,sd,0,.022,.1-L/2);                                   // ferrolho
    for(let i=0;i<6;i++)bx(.0515,.032,.003,GM.poly,0,.024,.09-i*.008); // serrilhado
    bx(.044,.032,L*.84,fr,0,-.016,.1-L*.48);                          // armação
    bx(.03,.006,L*.4,GM.poly,0,-.034,.1-L*.75);                        // trilho inferior
    cy(.009,.004,GM.bore,0,.026,.1-L-.001);                           // boca do cano
    bx(.007,.012,.008,GM.dark,0,.053,.1-L+.012);bx(.032,.011,.01,GM.dark,0,.052,.088); // miras
    bx(.043,.125,.058,fr,0,-.085,gz,.28);                             // empunhadura
    for(let i=0;i<4;i++)bx(.045,.006,.05,GM.dark,0,-.05-i*.025,gz+.008+i*.007,.28); // textura do cabo
    bx(.008,.006,.05,fr,0,-.047,gz-.055);bx(.008,.03,.006,fr,0,-.033,gz-.08);       // guarda-mato
    bx(.006,.022,.006,GM.dark,0,-.03,gz-.045,.2);                     // gatilho
    if(id==='tec9'){cy(.017,B+.04,GM.metal,0,.022,.1-L-B/2);magM=bx(.034,M,.045,GM.dark,0,-.035-M/2,.1-L*.55);muzzle=.1-L-B}
    else{magM=bx(.038,.022,.054,GM.dark,0,-.158,gz+.02,.28);muzzle=.1-L}
    grip=new THREE.Vector3(0,-.082,gz+.004);gRot=.28;fore=new THREE.Vector3(-.026,-.098,gz+.012);fRot=.28;  // duas mãos no cabo
  }else{                                                             // ---- primárias
    const furn=id==='ak'?GM.wood:id==='galil'||id==='famas'?GM.tan:GM.poly,rl=L*.55,hl=L*.5,f0=.1-rl,b0=f0-hl;
    bx(.056,.072,rl,GM.dark,0,0,.1-rl/2);                             // receptor
    bx(.058,.012,rl*.92,GM.metal,0,.042,.1-rl/2);                     // tampa / trilho
    bx(.002,.03,.05,GM.metal,.029,.008,.1-rl*.4);                     // janela de ejeção
    bx(.062,.064,hl,furn,0,-.004,f0-hl/2);                            // guarda-mão
    if(furn===GM.poly)for(let i=0;i<7;i++)bx(.034,.008,.012,GM.metal,0,.034,f0-.02-i*hl/7); // trilho picatinny
    else for(let i=0;i<3;i++)bx(.064,.008,.03,GM.dark,0,.01,f0-.03-i*hl/3); // frisos
    cy(.011,B+.05,GM.metal,0,.008,b0-B/2+.025);                       // cano
    if(sup){cy(.026,.22,GM.dark,0,.008,b0-B-.11);muzzle=b0-B-.22}      // silenciador
    else{cy(.016,.05,GM.dark,0,.008,b0-B-.01);cy(.011,.004,GM.bore,0,.008,b0-B-.036);bx(.008,.04,.008,GM.dark,0,.032,b0-B+.03);muzzle=b0-B-.035} // quebra-chamas e massa de mira
    if(shot){cy(.014,hl+B*.7,GM.metal,0,-.028,f0-(hl+B*.7)/2);if(g[5])cy(.026,.15,furn,0,-.028,f0-hl*.55)} // tubo e telha
    if(!shot&&M>.02){
      if(id==='ak'||id==='galil'){const mg=new THREE.Group();mg.position.set(0,-.036,.1-rl*.72);par.add(mg);
        const s1=new THREE.Mesh(BOX,GM.dark);s1.scale.set(.034,M*.5,.068);s1.position.set(0,-M*.24,0);s1.rotation.x=.12;mg.add(s1);
        const s2=new THREE.Mesh(BOX,GM.dark);s2.scale.set(.034,M*.52,.064);s2.position.set(0,-M*.68,-.035);s2.rotation.x=.42;mg.add(s2);magM=mg}
      else if(id==='p90')magM=bx(.05,.022,L*.75,GM.lens,0,.058,.1-L*.42);
      else magM=bx(.034,M,.064,GM.dark,0,-.036-M/2,.1-rl*.72,.1);
    }
    bx(.04,.11,.052,GM.poly,0,-.075,.075,.3);                         // empunhadura
    bx(.008,.006,.05,GM.dark,0,-.047,.02);bx(.006,.022,.006,GM.dark,0,-.03,.03,.2); // guarda-mato e gatilho
    if(g[4]){bx(.042,.058,.24,furn,0,-.016,.22);bx(.046,.1,.028,GM.poly,0,-.028,.345)} // coronha e soleira
    if(g[3]){const sz=.1-rl*.5;cy(.021,.2,GM.dark,0,.088,sz);cy(.03,.05,GM.dark,0,.088,sz-.11);cy(.026,.04,GM.dark,0,.088,sz+.11);
      cy(.027,.003,GM.lens,0,.088,sz-.136);cy(.022,.003,GM.lens,0,.088,sz+.131);bx(.02,.032,.02,GM.dark,0,.062,sz-.05);bx(.02,.032,.02,GM.dark,0,.062,sz+.05)} // luneta
    else bx(.032,.024,.02,GM.dark,0,.06,.1-rl+.04);                   // alça de mira
    grip=new THREE.Vector3(0,-.072,.074);gRot=.3;fore=new THREE.Vector3(0,-.044,shot&&g[5]?f0-hl*.55:f0-hl*.45);fRot=-1.45; // cabo e guarda-mão/telha
  }
  return {mag:magM||new THREE.Object3D(),muzzle,grip,gRot,fore,fRot};
}
function buildGun(w){
  while(wm.children.length)wm.remove(wm.children[0]);
  hL.visible=fL.visible=!w.k;
  if(w.gr){
    const o=GTPL?GTPL.clone():new THREE.Mesh(gGeo,gMat);o.scale.multiplyScalar(GTPL?.75:.6);o.position.set(0,.012,.035);wm.add(o);
    hR.position.set(0,-.004,.052);hR.rotation.set(-1.5,0,0);VMY=.11;arms();mag=new THREE.Object3D();mags=[];return;   // VMY sobe a mão para a granada aparecer inteira
  }
  if(w.k){
    const b=new THREE.Mesh(KB,GM.steel);b.position.set(0,0,-.02);wm.add(b);
    const h=new THREE.Mesh(CYL,GM.poly);h.scale.set(.016,.019,.12);h.position.set(0,-.002,.05);wm.add(h);
    const q=new THREE.Mesh(BOX,GM.dark);q.scale.set(.014,.055,.012);q.position.set(0,0,-.014);wm.add(q);
    hR.position.set(0,-.004,.052);hR.rotation.set(-1.5,0,0);VMY=0;arms();   // mão no cabo da faca
    mag=new THREE.Object3D();mags=[];return;
  }
  let r;const rs=[];mags=[];(w.x2?[-.08,.08]:[0]).forEach(o=>{const sg=new THREE.Group();sg.position.x=o;wm.add(sg);r=makeGun(w,sg);r.ox=o;rs.push(r);if(r.mag.parent){r.mag.userData.rest=r.mag.position.clone();mags.push(r.mag)}});
  const L0=rs[0];hR.position.copy(r.grip);hR.position.x+=r.ox;hR.rotation.set(r.gRot,0,0);   // mão direita no cabo
  if(w.x2){hL.position.copy(L0.grip);hL.position.x+=L0.ox;hL.rotation.set(L0.gRot,0,0)}     // duas pistolas: uma em cada mão
  else{hL.position.copy(r.fore);hL.rotation.set(r.fRot,0,0)}                                // esquerda no guarda-mão/telha ou apoiando no cabo
  HL0.copy(hL.position);HLR0=hL.rotation.x;EL.set(w.cat==='p'?-.24:-.3,-.52,w.cat==='p'?.18:0);VMY=w.cat==='p'?.055:0;arms();
  mag=r.mag;flash.position.z=r.muzzle-.04;mlight.position.z=r.muzzle-.1;
}
// ---------- recarga animada ----------
// Etapas (fração do tempo de recarga): inclina a arma → solta o pente vazio, que cai no chão → a mão esquerda
// desce até o colete e volta com outro pente → encaixa (clique) → puxa o ferrolho se a arma estava vazia → volta.
// Espingardas: cartucho por cartucho.
const HL0=new THREE.Vector3(),LERP=THREE.MathUtils.lerp;let HLR0=0;
let mags=[],RS={j:0},RFZ=-1;   // RFZ: congela a recarga num ponto (só no modo ?debug)
const sm=(a,b,p)=>{const t=Math.min(1,Math.max(0,(p-a)/(b-a)));return t*t*(3-2*t)};
const clk=(f,v)=>{v=(v||.05)*2.2;nz({type:'bandpass',f:f*4,q:2.5,v:v*3.2,d:.03,rv:.04});tn({type:'triangle',f:f*2.7,v:v*.9,d:.045});tn({f:f*4.3,v:v*.5,d:.035})};   // clique metálico
const drops=[];
function dropMag(m){                                                 // cópia do pente vazio cai no mundo
  const c=m.clone();m.getWorldPosition(c.position);m.getWorldQuaternion(c.quaternion);m.getWorldScale(c.scale);
  c.traverse(o=>{if(o.isMesh)o.castShadow=true});scene.add(c);
  drops.push({m:c,v:new THREE.Vector3(.5,-.6,.3).applyQuaternion(camera.quaternion),w:new THREE.Vector3(4+Math.random()*3,0,3+Math.random()*3),t:0,rx:0,rz:Math.PI/2,fy:.016});   // pousa deitado de lado
  if(drops.length>10){scene.remove(drops[0].m);drops.shift()}
}
function updateDrops(dt){
  for(let i=drops.length-1;i>=0;i--){
    const d=drops[i],p=d.m.position;d.t+=dt;
    if(!d.rest){
      d.v.y-=14*dt;p.addScaledVector(d.v,dt);d.m.rotation.x+=d.w.x*dt;d.m.rotation.z+=d.w.z*dt;
      const fy=d.fy||.04;
      if(p.y<fy){p.y=fy;if(Math.abs(d.v.y)<1.3){d.rest=true;d.m.rotation.set(d.rx!==undefined?d.rx:Math.PI/2,d.m.rotation.y,d.rz||0);clk(240,.025)}
        else{d.v.y=-d.v.y*.3;d.v.x*=.5;d.v.z*=.5;d.w.multiplyScalar(.5);clk(330,.035)}}
    }
    if(d.t>12&&!BODY){scene.remove(d.m);drops.splice(i,1)}   // no modo bodycam, armas e capacetes caídos ficam junto dos corpos
  }
  while(BODY&&drops.length>40){scene.remove(drops[0].m);drops.shift()}
}
function restPose(){
  const base=cw&&!cw.k;
  hL.position.copy(HL0);hL.rotation.x=HLR0;hL.visible=!!base;arms();
  mags.forEach(m=>{m.visible=true;m.position.copy(m.userData.rest)});
}
function reloadPose(p){                                              // devolve a inclinação da arma (0..1)
  RS.p=p;const base=true,tilt=sm(0,.14,p)*(1-sm(.86,1,p)),MR=mags.length?mags[0].userData.rest:null;
  let hx=HL0.x,hy=HL0.y,hz=HL0.z,show=base;
  if(cw.n>1){                                                        // espingarda: cartucho por cartucho
    const k=sm(.12,.2,p)*(1-sm(.8,.88,p)),n=Math.max(1,Math.min(MAG-RS.a0,6)),c=Math.min(n-.001,Math.max(0,(p-.2)/.6*n)),ph=c%1;
    hy+=k*(-.13+Math.sin(ph*Math.PI)*.09);hz+=k*.12;
    if(k>.5&&ph>.6&&RS.sh<=Math.floor(c)){RS.sh=Math.floor(c)+1;clk(950,.05);RS.j=.4}
    if(RS.empty&&p>.84&&!RS.rk){RS.rk=1;clk(480,.06);setTimeout(()=>clk(780,.05),90);RS.j=1}
  }else if(MR){
    const out=sm(.14,.26,p),down=sm(.22,.4,p)*(1-sm(.4,.58,p)),ins=sm(.58,.68,p),back=sm(.72,.86,p),go=sm(.1,.2,p)*(1-back);
    if(p>=.26&&!RS.dr){RS.dr=1;mags.forEach(dropMag);clk(380,.05)}
    show=base||(p>.08&&p<.9);
    const dy=p<.26?-out*.24:-(.24+down*.38)*(1-ins);
    mags.forEach(m=>{m.visible=p<.26||p>=.4;m.position.set(m.userData.rest.x,m.userData.rest.y+dy,m.userData.rest.z)});
    const m0=mags[0],G=m0.userData.grab||new THREE.Vector3(0,-.13,.01);            // a mão tira, carrega e encaixa o pente
    hx=LERP(HL0.x,m0.position.x+G.x,go);hy=LERP(HL0.y,m0.position.y+G.y,go);hz=LERP(HL0.z,m0.position.z+G.z,go);
    if(p>=.68&&!RS.in){RS.in=1;clk(620,.06);RS.j=.8}
    if(RS.empty&&p>=.76&&!RS.rk){RS.rk=1;clk(470,.06);setTimeout(()=>clk(820,.05),80);RS.j=1}
  }
  hL.position.set(hx,hy,hz);hL.visible=show;
  if(MR&&cw.n===1)hL.rotation.x=LERP(HLR0,.25,sm(.1,.2,p)*(1-sm(.72,.86,p)));   // vira a mão para segurar o pente
  arms();                                                            // o antebraço acompanha a mão
  return tilt;
}
function stash(){const id=eq[cur];if(id&&st[id]){st[id].a=ammo;st[id].r=reserve}}
function load(s){cur=s;scopeLv=0;if(isTouch)ads=false;const id=s===4?'gren':eq[s],w=WP[id],q=st[id]||{a:0,r:0};gHold=-1;cw=w;ammo=q.a;reserve=q.r;MAG=w.mag;RL=w.rl;reloading=false;cool=.3;firing=false;buildGun(w)}
const hasSlot=s=>s===4?gren>0:!!eq[s];
function equip(s){if(s===4&&gren<=0){banner('Sem granadas: compre na loja (B)');return}if(!eq[s]&&s!==4){banner('Sem arma primária: abra a loja (B)');return}if(cur!==4)prevSlot=cur;stash();load(s)}
function cycle(d){d=d===-1?-1:1;for(let i=1;i<=4;i++){const s=(cur-1+i*d+12)%4+1;if(hasSlot(s)){equip(s);return}}}   // d=-1 volta (scroll para cima)
function refill(){for(const id in own)st[id]={a:WP[id].mag,r:WP[id].res}}
function resup(){stash();for(const id in own){const w=WP[id];if(w.mag)st[id].r=Math.min(w.res,st[id].r+w.mag)}const q=st[eq[cur]];ammo=q.a;reserve=q.r}
function save(){stash();try{localStorage.setItem('arenafps_v1',JSON.stringify({money,own,eq,st,bestW,contW,contS,armor,gren}))}catch(e){}}
function loadSave(){
  try{const s=JSON.parse(localStorage.getItem('arenafps_v1')||'null');if(s&&s.own){money=s.money|0;own=s.own;eq=s.eq||eq;st=s.st||{};bestW=s.bestW|0;contW=s.contW|0;contS=s.contS|0;armor=Math.min(100,s.armor|0);gren=Math.min(GMAX,s.gren|0)}}catch(e){}
  for(const id in own)if(!WP[id])delete own[id];
  own.glock=1;own.knife=1;
  [1,2,3].forEach(s=>{if(eq[s]&&!own[eq[s]])eq[s]=null});
  if(!eq[2])eq[2]='glock';if(!eq[3])eq[3]='knife';
  for(const id in own)if(!st[id])st[id]={a:WP[id].mag,r:WP[id].res};
}
function startKit(){own={glock:1,knife:1};eq={1:null,2:'glock',3:'knife'};st={}}   // inventário inicial: Glock (2) e faca (3); a loja libera o resto de graça
function wipe(){money=800;armor=gren=0;startKit();contW=contS=0;refill();load(2);save()}
function stab(){
  cool=cw.cd;swing=1;whoosh(.13,.18);
  const ray=new THREE.Raycaster();ray.setFromCamera({x:0,y:0},camera);ray.far=2.6;
  const hit=ray.intersectObjects(enemies.flatMap(e=>e.meshes),false)[0];
  if(hit){const e=hit.object.userData.owner,hs=hit.object.userData.head;
    bloodFx(hit.point,ray.ray.direction,1);e.hp-=cw.dmg*(hs?2:1);e.hitT=.12;if(hs)hsFx();const hm=$('hm');hm.classList.toggle('hs',hs);hm.classList.add('on');hmT=.12;
    if(e.hp<=0)kill(e,hs,ray.ray.direction.clone(),hit.point.clone(),2.6);}
}
function icon(w){
  const c=document.createElement('canvas');c.width=120;c.height=44;const x=c.getContext('2d'),g=w.g,L=g[0],B=g[1],M=g[2];
  const s=100/(L+B+(g[4]?.28:.06)),R=(a,b,d,h)=>x.fillRect(8+a*s,b,d*s,h);
  x.fillStyle='#cfd6e0';R(0,17,B,4);R(B,13,L,9);R(B+L*.55,22,.05,Math.min(20,M*s*.7));R(B+L-.06,22,.06,11);
  if(g[4])R(B+L,15,.28,8);
  if(g[3]){x.fillStyle='#9fb3c8';R(B+L*.25,8,L*.45,4)}
  return c;
}
function renderShop(){
  const g=$('sg');g.innerHTML='';$('smn').textContent='$'+money;
  [['Pistolas','p'],['Intermediárias','i'],['Rifles','r']].forEach(c=>{
    const h=document.createElement('h3');h.textContent=c[0];g.appendChild(h);
    const gr=document.createElement('div');gr.className='gr';
    for(const id in WP){const w=WP[id];if(w.cat!==c[1])continue;
      const d=document.createElement('div');d.className='cd'+(own[id]?' own':'')+(eq[w.slot]===id?' eq':'')+(!own[id]&&money<w.price?' no':'');
      d.innerHTML='<b>'+w.name+'</b><small>Dano '+w.dmg+(w.n>1?' x'+w.n:'')+' | Pente '+w.mag+'</small><em>'+(eq[w.slot]===id?'Equipada':own[id]?'Equipar':'$'+w.price)+'</em>';
      const im=wIcon(id);if(im){const i=document.createElement('img');i.src=im;i.alt=w.name;d.prepend(i)}else d.prepend(icon(w));   // foto do modelo 3D
      d.onclick=()=>buy(id);gr.appendChild(d);}
    g.appendChild(gr);
  });
  const h=document.createElement('h3');h.textContent='Equipamento';g.appendChild(h);
  const gr=document.createElement('div');gr.className='gr';
  ITEMS.forEach(it=>{
    const full=it.full(),d=document.createElement('div');
    d.className='cd'+(full?' own':'')+(!full&&money<it.price?' no':'');
    d.innerHTML='<b>'+it.name+'</b><small>'+it.info()+'</small><em>'+(full?'Máximo':'$'+it.price)+'</em>';
    d.prepend(it.icon());d.onclick=()=>buyItem(it);gr.appendChild(d);
  });
  g.appendChild(gr);
}
function iconC(fn){const c=document.createElement('canvas');c.width=120;c.height=44;const x=c.getContext('2d');x.fillStyle='#cfd6e0';fn(x);return c}
const ITEMS=[
  {name:'Colete',price:650,full:()=>armor>=100,info:()=>'Proteção '+Math.ceil(armor)+'/100 · absorve metade do dano',buy:()=>{armor=100},
   icon:()=>iconC(x=>{x.beginPath();x.moveTo(44,6);x.lineTo(52,6);x.lineTo(60,12);x.lineTo(68,6);x.lineTo(76,6);x.lineTo(80,14);x.lineTo(78,40);x.lineTo(42,40);x.lineTo(40,14);x.fill();x.fillStyle='#8a96a6';x.fillRect(46,22,28,4)})},
  {name:'Granada',price:300,full:()=>gren>=GMAX,info:()=>'Dano até 110 · '+gren+'/'+GMAX+' · tecla 4: segure o clique e solte',buy:()=>{gren++},
   icon:()=>iconC(x=>{x.beginPath();x.arc(60,26,13,0,6.283);x.fill();x.fillRect(55,8,10,6);x.fillRect(64,6,10,3);x.fillStyle='#8a96a6';x.fillRect(48,24,24,2)})}
];
function buyItem(it){
  if(it.full()){$('smsg').textContent=it.name+': já no máximo';return}
  if(money<it.price){$('smsg').textContent='Dinheiro insuficiente';return}
  money-=it.price;it.buy();save();renderShop();$('smsg').textContent=it.name+' comprado';
}
function buy(id){
  const w=WP[id];
  if(!own[id]){if(money<w.price){$('smsg').textContent='Dinheiro insuficiente';return}money-=w.price;own[id]=1;st[id]={a:w.mag,r:w.res}}
  stash();eq[w.slot]=id;
  if(cur===w.slot||w.slot===1)load(w.slot);
  save();renderShop();$('smsg').textContent=w.name+' equipada';
}
// foto de cada arma para a loja: o modelo 3D renderizado de lado (cano para a direita) num renderer pequeno à parte
let IR=null;const ICONS={};
function wIcon(id){
  if(ICONS[id])return ICONS[id];const m=MDL[id];if(!m||!m.tpl)return null;
  if(!IR){IR=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});IR.setSize(300,120);IR.outputEncoding=THREE.sRGBEncoding;IR.toneMapping=THREE.ACESFilmicToneMapping;IR.toneMappingExposure=1.1}
  const sc=new THREE.Scene();sc.add(new THREE.HemisphereLight(0xffffff,0x3a4250,1.1));const dl=new THREE.DirectionalLight(0xffffff,1.6);dl.position.set(2,3,1);sc.add(dl);
  const o=m.tpl.clone();sc.add(o);o.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(o),c=b.getCenter(new THREE.Vector3()),s=b.getSize(new THREE.Vector3());
  const hw=Math.max(s.z,s.y*2.5)*.55,hh=hw/2.5,cam=new THREE.OrthographicCamera(-hw,hw,hh,-hh,.01,10);
  cam.position.set(c.x-2,c.y,c.z);cam.lookAt(c);IR.render(sc,cam);
  return ICONS[id]=IR.domElement.toDataURL('image/png');
}
function openShop(){
  if(playing&&!paused){paused=true;firing=false;lockedOnce=false;if(document.pointerLockElement)document.exitPointerLock()}
  renderShop();$('smsg').textContent='';$('shop').classList.remove('hide');$('ov').classList.add('hide');
}
function closeShop(){
  $('shop').classList.add('hide');
  if(playing&&paused)show('Pausado','O jogo está em pausa.','Continuar',['shopb','saveb','menub']);else $('ov').classList.remove('hide');
}
// ---------- bodycam ----------
// Modo de câmera corporal (tecla C ou botão no menu): câmera no peito, lente olho de peixe e imagem de gravação
// (shader bcPass no desktop; no celular, filtro CSS), sem mira, com REC, data e hora. Preferência em localStorage.
let bcYaw=0,bcPitch=0,bcT=0;
// ---------- rostos borrados (bodycam) ----------
// Como nas gravações policiais divulgadas: um borrão (backdrop-filter, em #fblur) sobre a cabeça de cada inimigo, vivo ou caído.
// Só aparece se a cabeça estiver à vista (raio contra as paredes), para o borrão não denunciar quem está escondido.
// Com a lente olho de peixe (bcPass), a posição na tela passa pela inversa do barril do shader.
const FBL=[],BXL=[],_fv=new THREE.Vector3(),_fd=new THREE.Vector3(),_fr=new THREE.Raycaster(),BN=1+.32*.5*1.64;
function faceBlur(){
  let n=0,nb=0,nf=0;
  if(BODY&&playing&&!paused){
    const lens=!!(bcPass&&bcPass.enabled),cp=camera.position,W=innerWidth,H=innerHeight,f=H/2/Math.tan(camera.fov*Math.PI/360);
    const scr=(w,o)=>{_fv.copy(w).project(camera);if(_fv.z>1)return null;let u=_fv.x*.5,v=_fv.y*.5,s=1;   // ponto do mundo → pixel na tela final
      if(lens){let pu=u*BN,pv=v*BN;for(let k=0;k<4;k++){const r2=(1.6*pu)**2+pv*pv,g=BN/(1+.32*r2);pu=u*g;pv=v*g;s=g}u=pu;v=pv}   // inversa do barril
      if(o){o.u=_fv.x*.5;o.v=_fv.y*.5;o.s=s}return[(u+.5)*W,(.5-v)*H]};
    const tg=[];   // cabeça + pontos do corpo (para a caixa em volta do boneco inteiro)
    for(const e of enemies){const h=e.meshes.find(o=>o.userData.head);if(!h)continue;
      const pts=e.meshes.map(o=>o.getWorldPosition(new THREE.Vector3()));pts.push(new THREE.Vector3(e.x,0,e.z));
      const hp=h.getWorldPosition(new THREE.Vector3());pts.push(hp.clone().setY(hp.y+.16));tg.push([hp,pts])}
    for(const d of dying)if(d.p.H){const pts=[];for(const k in d.p)pts.push(d.p[k].c);tg.push([d.p.H.c,pts,d.t<5])}   // corpo antigo: só o rosto, sem caixa
    const o={};
    for(const [hp,pts,box=true] of tg){
      const dist=hp.distanceTo(cp);if(dist<.4||dist>70)continue;
      _fv.copy(hp).project(camera);if(_fv.z>1||Math.abs(_fv.x)>1.3||Math.abs(_fv.y)>1.3)continue;
      _fr.set(cp,_fd.subVectors(hp,cp).normalize());_fr.far=dist-.3;if(_fr.intersectObjects(solids,false).length)continue;   // cabeça escondida: nada
      const c=scr(hp,o),r0=Math.max(9,.19*f/dist),r=r0*o.s;
      if(lens&&nf<16)bcPass.uniforms.faces.value[nf++].set(o.u+.5,o.v+.5,r0/W,r0*1.15/H);   // mosaico no shader (uv antes da lente)
      else{let el=FBL[n];if(!el){el=document.createElement('i');el.className='f';$('fblur').appendChild(el);FBL.push(el)}   // sem shader: borrão no rosto
        el.style.cssText='display:block;left:'+(c[0]-r)+'px;top:'+(c[1]-r*1.15)+'px;width:'+(2*r)+'px;height:'+(2.3*r)+'px';n++}
      if(!box)continue;
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const q of pts){const a=scr(q);if(!a)continue;if(a[0]<x0)x0=a[0];if(a[0]>x1)x1=a[0];if(a[1]<y0)y0=a[1];if(a[1]>y1)y1=a[1]}
      const pad=Math.max(4,r*.45);x0-=pad;x1+=pad;y0-=pad;y1+=pad;
      let bx=BXL[nb];if(!bx){bx=document.createElement('b');$('fblur').appendChild(bx);BXL.push(bx)}   // caixa verde em volta do corpo
      bx.style.cssText='display:block;left:'+x0+'px;top:'+y0+'px;width:'+(x1-x0)+'px;height:'+(y1-y0)+'px';nb++;
    }
  }
  for(let i=n;i<FBL.length;i++)if(FBL[i].style.display!=='none')FBL[i].style.display='none';
  for(let i=nb;i<BXL.length;i++)if(BXL[i].style.display!=='none')BXL[i].style.display='none';
  if(bcPass)bcPass.uniforms.nf.value=nf;
}
function setBody(mode,boot){BMODE=mode;const v=BODY=mode>0;try{localStorage.setItem('arenafps_cam',String(mode))}catch(e){}
  if(MAPI!==mode){if(playing&&alive){contW=Math.max(contW,wave-1);contS=score;save()}setMap(mode);if(!boot){playing=false;paused=false;if(document.pointerLockElement)document.exitPointerLock();showTitle()}}
  if(bcPass)bcPass.enabled=v;document.body.classList.toggle('bodycam',v);$('camb').textContent=['Modo bodycam: desligado','Bodycam: trincheira','Bodycam: casa'][mode];onResize()}
function showTitle(){
  wantCont=contW>0;
  show('Arena FPS','Dinheiro $'+money+(bestW?'  |  Melhor onda '+bestW:'')+(location.protocol==='file:'?'  |  Aberto direto do arquivo: soldados e armas 3D não carregam. Abra pelo jogar.bat.':''),wantCont?'Continuar (onda '+(contW+1)+')':'Jogar',['newb','shopb']);
}
let alive=false,playing=false,paused=false,needReset=true,reloading=false,rt=0,cool=0,kick=0,flashT=0,hmT=0,dmgA=0,bobT=0;
const enemies=[],shots=[];
const keys={};let firing=false;

// ---------- som ----------
// Tudo sintetizado com Web Audio (sem arquivos): camadas de ruído filtrado e osciladores com envelope, um compressor no fim
// e um reverb de convolução gerado (resposta ao impulso de ruído decaindo). Sons com posição (tiros dos inimigos, explosões)
// ficam mais baixos, abafados, atrasados pela velocidade do som e no lado certo do fone conforme a distância e a direção.
let ac,MIX=null;
function audioInit(){
  if(!ac)return null;if(MIX)return MIX;
  const comp=ac.createDynamicsCompressor();comp.threshold.value=-6;comp.knee.value=8;comp.ratio.value=4;comp.attack.value=.002;comp.release.value=.18;
  const master=ac.createGain();master.gain.value=.95;comp.connect(master);
  const sat=ac.createWaveShaper(),cu=new Float32Array(1024);for(let k=0;k<1024;k++){const x=k/511.5-1;cu[k]=Math.tanh(x*1.6)/Math.tanh(1.6)}sat.curve=cu;master.connect(sat);sat.connect(ac.destination);   // saturação suave: picos de AWP e explosão não estouram
  const dry=ac.createGain();dry.gain.value=2.2;dry.connect(comp);
  const sr=ac.sampleRate,L=sr*2.4|0,ir=ac.createBuffer(2,L,sr);   // reverb: ruído com decaimento e agudos caindo
  for(let c=0;c<2;c++){const d=ir.getChannelData(c);let lp=0;for(let k=0;k<L;k++){const t=k/L;lp+=(Math.random()*2-1-lp)*(.5-.42*t);d[k]=lp*Math.pow(1-t,3.2)}}
  const rv=ac.createConvolver();rv.buffer=ir;const wet=ac.createGain();wet.gain.value=1.3;rv.connect(wet);wet.connect(comp);
  const NB=ac.createBuffer(1,sr*2,sr),nd=NB.getChannelData(0);for(let k=0;k<nd.length;k++)nd[k]=Math.random()*2-1;
  return MIX={dry,rv,NB};
}
const REV=()=>[.35,.2,.42][MAPI]||.3;   // quanto de reverb por mapa (arena com muros, trincheira aberta, casa)
function sOut(g,o,t){let n=g;if(o.pan&&ac.createStereoPanner){const pn=ac.createStereoPanner();pn.pan.value=o.pan;g.connect(pn);n=pn}
  n.connect(MIX.dry);if(o.rv){const sd=ac.createGain();sd.gain.value=o.rv;n.connect(sd);sd.connect(MIX.rv)}}
function env(g,o,t){g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,o.v),t+(o.a||.002));g.gain.exponentialRampToValueAtTime(.0001,t+o.d)}
function nz(o){                                                      // ruído filtrado: {type,f,f2,q,v,a,d,at,pan,rv}
  if(!audioInit()||o.v<.0005)return;try{const t=ac.currentTime+(o.at||0),src=ac.createBufferSource(),f=ac.createBiquadFilter(),g=ac.createGain();
  src.buffer=MIX.NB;f.type=o.type||'lowpass';f.frequency.setValueAtTime(o.f,t);if(o.f2)f.frequency.exponentialRampToValueAtTime(o.f2,t+o.d);f.Q.value=o.q||.7;
  env(g,o,t);src.connect(f);f.connect(g);sOut(g,o,t);src.start(t,Math.random()*1.5);src.stop(t+o.d+.05)}catch(e){}}
function tn(o){                                                      // tom: {type,f,f2,v,a,d,at,pan,rv}
  if(!audioInit()||o.v<.0005)return;try{const t=ac.currentTime+(o.at||0),os=ac.createOscillator(),g=ac.createGain();
  os.type=o.type||'sine';os.frequency.setValueAtTime(o.f,t);if(o.f2)os.frequency.exponentialRampToValueAtTime(o.f2,t+o.d);
  env(g,o,t);os.connect(g);sOut(g,o,t);os.start(t);os.stop(t+o.d+.05)}catch(e){}}
function beep(f,d,type,v){tn({type:type==='square'||type==='sawtooth'?'triangle':type,f,f2:Math.max(40,f*.6),v:(v||.05)*.8,d})}   // avisos de interface
function where(pos){                                                 // distância, atraso, volume, abafamento e lado de um ponto
  const dx=pos.x-camera.position.x,dz=pos.z-camera.position.z,dist=Math.hypot(dx,dz,pos.y-camera.position.y)||1;
  return{dist,at:Math.min(.25,dist/343),att:1/(1+dist*.12),br:Math.max(.12,1/(1+dist*.05)),pan:Math.max(-.85,Math.min(.85,(dx*Math.cos(yaw)-dz*Math.sin(yaw))/Math.hypot(dx,dz||1e-3)))}}
// tiro: estalo (supersônico), corpo, soco grave, cauda com reverb e, ao ar livre, eco atrasado. kind: 'p' pistola, 'r' fuzil/submetralhadora, 's' sniper
function gunshot(v,kind,pos){
  if(!audioInit())return;const q=(v||.35)*1.6,k=kind||'r',sc=k==='s'?1.45:k==='p'?.8:1,R=REV(),w=pos?where(pos):{at:0,att:1,br:1,pan:0,dist:0};
  const V=q*w.att,at=w.at+Math.random()*.004,o={at,pan:w.pan},r=Math.random()*.15+.92;
  nz({...o,type:'highpass',f:2800*r,v:.55*V*sc*w.br*w.br,d:.025,rv:.05});
  nz({...o,type:'lowpass',f:(k==='p'?3600:2800)*w.br*r,f2:380,q:.9,v:.95*V*sc,d:.16*sc,rv:R});
  tn({...o,f:(k==='s'?105:k==='p'?165:135)*r,f2:36,v:.75*V*sc,d:.2*sc,rv:R*.4});
  nz({...o,type:'bandpass',f:(k==='s'?700:950)*w.br,q:.7,v:.16*V*sc,a:.025,d:.75*sc,at:at+.03,rv:R*1.6+w.dist*.01});
  if(MAPI!==2)nz({...o,type:'lowpass',f:750*w.br,v:.12*V*sc,a:.03,d:.5,at:at+.2+Math.random()*.08,rv:R});   // eco ao ar livre
  if(k==='s'&&!pos){setTimeout(()=>clk(300,.07),cw.cd*380);setTimeout(()=>clk(520,.06),cw.cd*520)}         // ferrolho da AWP
}
function explosionSnd(pos){
  const w=where(pos),V=Math.min(1.4,2.6*w.att),o={at:w.at,pan:w.pan*.6},R=REV();
  nz({...o,type:'highpass',f:1800,v:.6*V*w.br,d:.05,rv:.1});
  nz({...o,type:'lowpass',f:1400*w.br,f2:120,q:1,v:1.2*V,d:1.4,rv:R*1.4});
  tn({...o,f:70,f2:22,v:1.1*V,d:1.1,rv:R*.3});
  nz({...o,type:'bandpass',f:500,q:.6,v:.35*V,a:.05,d:2.4,at:o.at+.08,rv:R*2});
  for(let k=0;k<7;k++)nz({...o,type:'bandpass',f:2200+Math.random()*2500,q:3,v:.06*V*w.br,d:.05,at:o.at+.35+Math.random()*1.1});   // destroços caindo
}
function stepSnd(){                                                  // passo: concreto (arena) ou terra/cascalho (bodycam)
  const k=1.6*(1-.65*crK)*(1+.6*spK),r=.9+Math.random()*.2;
  if(MAPI===0){nz({type:'bandpass',f:1700*r,q:1.3,v:.05*k,d:.05,rv:.15});tn({f:95*r,f2:50,v:.07*k,d:.07})}
  else{for(let i=0;i<4;i++)nz({type:'bandpass',f:(2400+Math.random()*3000),q:2.5,v:.028*k,d:.035,at:i*.014+Math.random()*.01});nz({type:'lowpass',f:520*r,v:.07*k,d:.09})}
}
const whoosh=(v,d)=>nz({type:'bandpass',f:500,f2:2600,q:1.4,v:v||.12,a:(d||.2)*.4,d:d||.2});
const hitFlesh=pos=>{const w=where(pos);nz({at:w.at,pan:w.pan,type:'lowpass',f:900,v:.22*w.att+.03,d:.09,rv:.05});tn({at:w.at,pan:w.pan,f:120,f2:60,v:.1*w.att,d:.08})};
const hitHard=pos=>{const w=where(pos);nz({at:w.at,pan:w.pan,type:'bandpass',f:2600*w.br,q:1.2,v:.12*w.att+.01,d:.05,rv:.1})};
// ---------- inimigos ----------
// geometrias e materiais compartilhados por todos os soldados (nada é recriado a cada onda)
const EG={sph:new THREE.SphereGeometry(1,16,12),cyl:new THREE.CylinderGeometry(1,1,1,14),cylT:new THREE.CylinderGeometry(.8,1,1,14),box:BOX,helm:new THREE.SphereGeometry(1,18,10,0,6.283,0,1.75)};
const EM={
  uni:new THREE.MeshStandardMaterial({map:camoT,roughness:.92,envMapIntensity:.3}),
  vest:new THREE.MeshStandardMaterial({color:0x56573a,roughness:.85,envMapIntensity:.3}),
  gear:new THREE.MeshStandardMaterial({color:0x2a2c28,roughness:.8,envMapIntensity:.3}),
  skin:new THREE.MeshStandardMaterial({color:0xb98767,roughness:.65,envMapIntensity:.3}),
  boot:new THREE.MeshStandardMaterial({color:0x1d1915,roughness:.7,envMapIntensity:.3}),
  glove:new THREE.MeshStandardMaterial({color:0x242424,roughness:.8,envMapIntensity:.3}),
  helm:new THREE.MeshStandardMaterial({color:0x4b5036,roughness:.72,envMapIntensity:.3})
};
let EGUN=null;
function epart(geo,m,s,x,y,z,par,rx){const o=new THREE.Mesh(geo,m);o.scale.set(s[0],s[1],s[2]);o.position.set(x,y,z);if(rx)o.rotation.x=rx;o.castShadow=true;par.add(o);return o}
function makeSoldier(){
  const g=new THREE.Group(),j={};
  ['L','R'].forEach((s,i)=>{                                         // pernas
    const hip=new THREE.Group();hip.position.set(i?.11:-.11,.93,0);g.add(hip);
    epart(EG.cylT,EM.uni,[.085,.46,.092],0,-.22,0,hip,Math.PI);       // coxa
    const knee=new THREE.Group();knee.position.y=-.45;hip.add(knee);
    epart(EG.box,EM.gear,[.1,.11,.05],0,-.01,.07,knee);               // joelheira
    epart(EG.cylT,EM.uni,[.068,.43,.075],0,-.21,0,knee,Math.PI);       // canela
    epart(EG.box,EM.boot,[.11,.11,.26],0,-.44,.04,knee);              // bota
    j['hip'+s]=hip;j['knee'+s]=knee;
  });
  const torso=new THREE.Group();torso.position.y=.93;g.add(torso);j.torso=torso;
  epart(EG.cyl,EM.uni,[.17,.2,.12],0,.03,0,torso);                    // quadril
  epart(EG.box,EM.gear,[.35,.05,.25],0,.12,0,torso);                  // cinto
  epart(EG.cylT,EM.uni,[.2,.5,.135],0,.39,0,torso,Math.PI);           // peito
  epart(EG.box,EM.vest,[.43,.37,.3],0,.41,0,torso);                   // colete
  for(let k=-1;k<=1;k++)epart(EG.box,EM.vest,[.105,.13,.06],k*.13,.31,.17,torso); // porta-carregadores
  epart(EG.box,EM.gear,[.13,.06,.03],.1,.53,.16,torso);               // rádio
  epart(EG.box,EM.gear,[.3,.33,.12],0,.43,-.2,torso);                 // mochila
  epart(EG.cyl,EM.skin,[.055,.12,.055],0,.67,0,torso);                // pescoço
  const head=new THREE.Group();head.position.y=.81;torso.add(head);j.head=head;
  epart(EG.sph,EM.skin,[.1,.122,.112],0,0,0,head);                    // cabeça
  epart(EG.sph,EM.gear,[.104,.075,.114],0,-.05,.01,head);             // balaclava
  const helm=epart(EG.helm,EM.helm,[.132,.12,.145],0,.015,-.01,head); // capacete
  epart(EG.box,EM.gear,[.2,.03,.03],0,.035,.112,head);                // alça dos óculos
  epart(EG.box,GM.lens,[.16,.042,.025],0,.018,.115,head);             // óculos
  ['L','R'].forEach((s,i)=>{                                         // braços
    const sh=new THREE.Group();sh.position.set(i?.25:-.25,.6,0);torso.add(sh);
    epart(EG.sph,EM.uni,[.075,.075,.075],0,0,0,sh);
    epart(EG.cyl,EM.uni,[.058,.3,.058],0,-.15,0,sh);
    const el=new THREE.Group();el.position.y=-.3;sh.add(el);
    epart(EG.cyl,EM.uni,[.05,.27,.05],0,-.135,0,el);
    epart(EG.sph,EM.glove,[.045,.06,.05],0,-.3,0,el);
    j['sh'+s]=sh;j['el'+s]=el;
  });
  j.shR.rotation.set(-.75,0,-.15);j.elR.rotation.set(-.85,0,0);        // pose de tiro: coronha no ombro
  j.shL.rotation.set(-1.35,0,.6);j.elL.rotation.set(-.15,0,0);
  if(!EGUN){EGUN=new THREE.Group();makeGun(WP.ak,EGUN,true);EGUN.traverse(o=>{if(o.isMesh)o.castShadow=true});EGUN.rotation.y=Math.PI;EGUN.scale.setScalar(.85)}
  const eg=EGUN.clone();eg.position.set(.14,.45,.42);torso.add(eg);
  return {g,j,head,helm,gun:eg};
}
// ---------- itens no mapa (munição e cura) ----------
// A cada onda surgem caixas de munição e kits médicos em pontos fixos livres. Passar por cima coleta.
const PICK_PTS=PICK1.slice();   // pontos do mapa atual (setMap troca)
const PM={
  olive:new THREE.MeshStandardMaterial({color:0x4d5428,roughness:.75,envMapIntensity:.3}),
  strip:new THREE.MeshStandardMaterial({color:0xd8b024,roughness:.6,envMapIntensity:.3}),
  brass:new THREE.MeshStandardMaterial({color:0xc9a227,metalness:.9,roughness:.3,envMapIntensity:.5}),
  white:new THREE.MeshStandardMaterial({color:0xe9ece8,roughness:.5,envMapIntensity:.4}),
  red:new THREE.MeshStandardMaterial({color:0xc4161c,roughness:.5,emissive:0x400000,envMapIntensity:.3}),
  dark:GM.dark
};
const pickups=[];
function pickModel(type){
  const g=new THREE.Group(),bx=(m,s,x,y,z)=>{const o=new THREE.Mesh(BOX,m);o.scale.set(s[0],s[1],s[2]);o.position.set(x,y,z);o.castShadow=true;g.add(o);return o};
  if(type==='ammo'){
    bx(PM.olive,[.55,.26,.32],0,.13,0);bx(PM.dark,[.57,.04,.34],0,.27,0);       // caixa e tampa
    bx(PM.strip,[.56,.05,.33],0,.08,0);bx(PM.dark,[.12,.03,.03],0,.3,0);         // faixa amarela e alça
    for(let i=0;i<4;i++){const c=new THREE.Mesh(CYL,PM.brass);c.scale.set(.018,.018,.09);c.rotation.x=-Math.PI/2;c.position.set(-.15+i*.1,.33,-.08);g.add(c)} // cartuchos
  }else{
    bx(PM.white,[.46,.24,.32],0,.12,0);bx(PM.dark,[.12,.03,.03],0,.255,0);
    bx(PM.red,[.2,.012,.06],0,.246,0);bx(PM.red,[.06,.012,.2],0,.246,0);         // cruz em cima
    bx(PM.red,[.16,.05,.012],0,.12,.162);bx(PM.red,[.05,.16,.012],0,.12,.162);   // cruz na frente
  }
  return g;
}
function spawnPickups(){
  pickups.forEach(p=>scene.remove(p.g));pickups.length=0;
  const free=PICK_PTS.slice().sort(()=>Math.random()-.5),list=['ammo','ammo','med'];
  if(wave%3===0)list.push('med');
  list.forEach((t,i)=>{const pt=free[i],g=pickModel(t);g.position.set(pt[0],0,pt[1]);scene.add(g);pickups.push({g,t,x:pt[0],z:pt[1],ph:Math.random()*6})});
}
function giveAmmo(){                                                 // +2 pentes na arma da mão, +1 nas outras
  stash();let got=false;
  for(const id in own){const w=WP[id];if(!w.mag)continue;const nr=Math.min(w.res,st[id].r+w.mag*(id===eq[cur]?2:1));if(nr>st[id].r){st[id].r=nr;got=true}}
  const q=st[eq[cur]];ammo=q.a;reserve=q.r;return got;
}
function pickFx(t,c){const b=$('pick');b.textContent=t;b.style.color=c;b.classList.remove('on');void b.offsetWidth;b.classList.add('on')}
function updatePickups(dt){
  for(let i=pickups.length-1;i>=0;i--){
    const p=pickups[i];p.ph+=dt;p.g.rotation.y+=dt*.9;p.g.position.y=.08+Math.sin(p.ph*2.2)*.06;
    if(Math.hypot(P.x-p.x,P.z-p.z)>1||P.y>.8)continue;
    let ok=false;
    if(p.t==='med'&&hp<100){hp=Math.min(100,hp+40);ok=true;pickFx('+40 vida','#6dff8a');beep(520,.08,'sine',.06);setTimeout(()=>beep(780,.1,'sine',.06),90)}
    if(p.t==='ammo'&&giveAmmo()){ok=true;pickFx('+ munição','#ffd34d');clk(700,.06);setTimeout(()=>clk(500,.06),70)}
    if(ok){scene.remove(p.g);pickups.splice(i,1)}
  }
}
// ---------- soldado 3D (modelo e animações da Quaternius, CC0, em assets/) ----------
// Carrega assets/soldado.gltf (malha com esqueleto) e assets/animacoes.glb (mesmo esqueleto). Enquanto não carrega,
// ou se falhar (index.html aberto direto, sem servidor), os inimigos usam o soldado procedural (makeSoldier).
let SOLD=null,SOLDW=true;   // SOLDW: soldado ainda carregando (a primeira onda espera)
const UPPER=/^(spine_0[123]|neck_01|Head|clavicle|upperarm|lowerarm|hand|index|middle|pinky|ring|thumb)/;
// ?debug: mostra na tela qual soldado carregou e por que os outros falharam (para diagnosticar no celular, sem console)
function dbgMsg(m){console.info('Arena FPS: '+m);if(!/[?&]debug/.test(location.search))return;let d=$('dbgm');
  if(!d){d=document.createElement('div');d.id='dbgm';d.style.cssText='position:fixed;left:50%;top:4px;transform:translateX(-50%);z-index:20;max-width:90vw;background:#000c;color:#ffd166;font:12px monospace;padding:4px 8px;border-radius:4px;pointer-events:none;white-space:pre-wrap';document.body.appendChild(d)}
  d.textContent+=(d.textContent?' | ':'')+m}
const errTxt=e=>e?(e.message||(e.target&&e.target.status?'HTTP '+e.target.status:'')||String(e)).slice(0,160):'?';
function loadSoldier(){
  const done=()=>{SOLDW=false;loadWeapons()};                        // armas só depois do soldado, para não disputar o download
  if(!THREE.GLTFLoader||!THREE.SkeletonUtils||location.protocol==='file:')return done();
  const L=new THREE.GLTFLoader(),fail=e=>{console.warn('soldado 3D indisponível, usando o procedural',e);done()};
  const quat=()=>L.load('assets/soldado.gltf',g=>L.load('assets/animacoes.glb',a=>{try{SOLD=prepSoldier(g.scene,a.animations);dbgMsg('soldado Quaternius');done()}catch(err){fail(err)}},undefined,fail),undefined,fail);
  const tat=()=>L.load('assets/tatico.glb',g=>{try{SOLD=prepMixamo(g);VA=makeVArms();dbgMsg('soldado tático');done()}catch(err){console.warn(err);dbgMsg('tático falhou: '+errTxt(err));quat()}},undefined,e=>{dbgMsg('tático não baixou: '+errTxt(e));quat()});
  L.load('assets/russo.glb',g=>{try{SOLD=prepMixamo(g,'assets/russo/');VA=makeVArms();dbgMsg('soldado russo'+(isTouch?' (celular)':''));done()}catch(err){console.warn(err);dbgMsg('russo falhou: '+errTxt(err));tat()}},undefined,e=>{dbgMsg('russo não baixou: '+errTxt(e));tat()});
}
// soldado tático (Sketchfab "Character (Type Tactical Man 1)" de LokitoBlu, CC BY 4.0, rig e animações de fuzil da Mixamo)
// assets/tatico.glb: corpo (cm) + clipes idle/run/fire/hit/back/crouch. Sem texturas: cada peça recebe uma cor.
const MX='mixamorig',MUP=/(Spine|Neck|Head|Shoulder|Arm|Hand)/;
// ---------- braços do jogador (mesmo modelo dos inimigos) ----------
// Clone do soldado tático preso à câmera, só luvas e mangas visíveis. Os dedos vêm da pose de mira e cada braço é
// dobrado por IK de dois ossos até os alvos das mãos procedurais (hR/hL), que já seguem o cabo, o apoio e a recarga.
let VA=null;
const VSH=new THREE.Vector3(.21,-.32,.1),VSC=1;                  // ombro direito em relação à câmera; escala do braço
function makeVArms(){
  const r=THREE.SkeletonUtils.clone(SOLD.root),rm=[];
  r.traverse(o=>{if(o.name==='capacete'||o.name==='fuzil'||(o.userData&&o.userData.hb))rm.push(o)});rm.forEach(o=>o.parent.remove(o));
  r.traverse(o=>{if(o.isSkinnedMesh){o.visible=/^(Gloves|Tops)$/.test(o.name);o.castShadow=false;o.frustumCulled=false}});
  const B={};r.traverse(o=>{if(o.isBone)B[o.name.replace(SOLD.pre,'')]=o});
  const mx=new THREE.AnimationMixer(r);mx.clipAction(SOLD.S.idle).play();mx.update(0);   // mãos fechadas da pose de mira
  // some com tronco, pescoço e cabeça (coluna em escala ~0) sem mexer nos braços (ombros compensam a escala)
  const E=1e-3;B.Spine.scale.setScalar(E);B.LeftShoulder.scale.setScalar(1/E);B.RightShoulder.scale.setScalar(1/E);
  B.LeftHand.scale.setScalar(.75);B.RightHand.scale.setScalar(.75);   // a mão do modelo tem 15 cm do pulso aos nós; real ~10-11 cm
  r.rotation.y=Math.PI;r.scale.setScalar(VSC);camera.add(r);
  camera.updateMatrixWorld(true);
  const sh=camera.worldToLocal(B.RightArm.getWorldPosition(new THREE.Vector3()));r.position.add(VSH.clone().sub(sh));
  gl.visible=sl.visible=false;                                       // esconde as mãos procedurais
  return {r,B,base:r.position.clone()};
}
const _ia=new THREE.Vector3(),_ib=new THREE.Vector3(),_it=new THREE.Vector3(),_iq=new THREE.Quaternion(),_iw=new THREE.Quaternion(),_ip=new THREE.Quaternion();
function aimBone(bone,childNow,target){                               // gira o osso para o filho ir na direção do alvo
  const p=bone.getWorldPosition(_ia);
  _iq.setFromUnitVectors(childNow.clone().sub(p).normalize(),target.clone().sub(p).normalize());
  bone.getWorldQuaternion(_iw).premultiply(_iq);
  bone.parent.getWorldQuaternion(_ip).invert();
  bone.quaternion.copy(_ip.multiply(_iw));bone.updateMatrixWorld(true);
}
function ikArm(s,tgt,pole,hand){
  const B=VA.B,up=B[s+'Arm'],lo=B[s+'ForeArm'],ha=B[s+'Hand'];
  const a=up.getWorldPosition(new THREE.Vector3()),b=lo.getWorldPosition(new THREE.Vector3()),c=ha.getWorldPosition(new THREE.Vector3());
  const L1=a.distanceTo(b),L2=b.distanceTo(c),dir=tgt.clone().sub(a),d=Math.min(dir.length(),L1+L2-1e-4);dir.normalize();
  const x=(L1*L1-L2*L2+d*d)/(2*d),h=Math.sqrt(Math.max(0,L1*L1-x*x));
  const n=pole.clone().sub(a);n.addScaledVector(dir,-n.dot(dir)).normalize();
  aimBone(up,b,a.clone().addScaledVector(dir,x).addScaledVector(n,h));
  aimBone(lo,ha.getWorldPosition(new THREE.Vector3()),a.clone().addScaledVector(dir,d));
  if(!hand)return;
  // mão: direção dos nós dos dedos (fd) e do polegar (td), em coordenadas do mundo
  const w=ha.getWorldPosition(new THREE.Vector3()),fd=hand[0],td=hand[1];
  aimBone(ha,B[s+'HandMiddle1'].getWorldPosition(new THREE.Vector3()),w.clone().add(fd));
  const cur=B[s+'HandThumb1'].getWorldPosition(new THREE.Vector3()).sub(w),pr=v=>v.addScaledVector(fd,-v.dot(fd)).normalize();
  _iq.setFromUnitVectors(pr(cur),pr(td.clone()));
  ha.getWorldQuaternion(_iw).premultiply(_iq);ha.parent.getWorldQuaternion(_ip).invert();ha.quaternion.copy(_ip.multiply(_iw));
}
// pegadas no espaço da arma (x direita, y cima, -z frente), relativas a hR/hL (cabo / apoio):
// o = nó do dedo médio, f = pulso→nós dos dedos, t = polegar, c = dobra das 3 falanges, th = dobra do polegar
const GRIP={
  p:{R:{o:[.012,-.015,-.028],f:[0,-.3,-.95],t:[-.35,.55,-.75],c:[1.35,1.45,1],th:[.2,.3,.2],tb:-.8},
     L:{o:[-.016,-.045,-.04],f:[.35,-.25,-.9],t:[.15,.35,-.95],c:[1.2,1.3,.9],th:[.1,.2,.1]}},
  r:{R:{o:[.012,-.015,-.028],f:[0,-.3,-.95],t:[-.35,.55,-.75],c:[1.35,1.45,1],th:[.2,.3,.2],tb:-.8},
     L:{o:[.045,-.045,-.06],f:[.7,.15,-.7],t:[-.2,.4,-.9],c:[1.3,.6,.3],th:[.1,.2,.1]}},   // palma sob o guarda-mão, dedos sobem pelo lado direito, polegar no esquerdo
  k:{R:{o:[.012,-.01,-.02],f:[0,-.15,-1],t:[-.3,.6,-.7],c:[1.4,1.5,1.1],th:[.3,.4,.3]}},
  M:{o:[-.02,.02,-.02],f:[.15,.35,-.92],t:[0,1,0],c:[1.2,1,.6],th:[.2,.3,.2]}   // recarga: mão esquerda segurando o pente
};
const _ev=new THREE.Euler();
function gripOf(s){
  if(s==='L'&&reloading&&mags.length&&cw.n===1&&RS.p>.12&&RS.p<.8)return GRIP.M;
  if(cw.x2&&s==='L'){const r=GRIP.p.R;return{o:[-r.o[0],r.o[1],r.o[2]],f:[-r.f[0],r.f[1],r.f[2]],t:[-r.t[0],r.t[1],r.t[2]],c:r.c,th:r.th,tb:r.tb}}   // duas pistolas: esquerda espelha a direita
  const g=GRIP[cw.k?'k':cw.cat==='p'?'p':'r'][s];
  if(adsK>.001&&cw.cat==='p'){   // mirando: a mão inteira (dedos e polegar juntos) gira para cima em X, pulso abaixo do cabo e
    const a=(s==='R'?.83:.76)*adsK,c=Math.cos(a),n=Math.sin(a),R=v=>[v[0],v[1]*c-v[2]*n,v[1]*n+v[2]*c],k=adsK;   // antebraço por baixo, fora da linha de visão;
    return Object.assign({},g,{f:R(g.f),t:R(g.t),o:[g.o[0],g.o[1]+.04*k,g.o[2]+.01*k]})}   // girar só os dedos torcia a mão (polegar paralelo aos dedos)
  return g;
}
function curlHand(s,g){                                               // fecha os dedos em volta do cabo
  const B=VA.B,ix=B[s+'HandIndex1'],meta=ix&&ix.position.y<.6*B[s+'HandMiddle1'].position.y;   // meta: rig em que Index1 é o osso da palma (soldado russo, mão direita)
  if(meta&&!ix.userData.q0)ix.userData.q0=ix.quaternion.clone();
  ['Index','Middle','Ring','Pinky'].forEach((f,k)=>{const sh=f==='Index'&&meta?1:0;for(let i=1;i<=3;i++){const b=B[s+'Hand'+f+i];if(!b)continue;
    if(i<=sh){b.quaternion.copy(b.userData.q0);continue}b.quaternion.setFromEuler(_ev.set(g.c[i-1-sh]*(1-k*.04),0,0))}});
  const t1=B[s+'HandThumb1'];if(!t1.userData.q0)t1.userData.q0=t1.quaternion.clone();
  t1.quaternion.copy(t1.userData.q0).multiply(_iq.setFromEuler(_ev.set(g.tb||0,0,0)));   // tb: fecha o polegar junto à arma
  for(let i=2;i<=3;i++){const b=B[s+'HandThumb'+i];if(b)b.quaternion.setFromEuler(_ev.set(g.th[i-1],0,0))}
}
function viewArms(){
  VA.r.position.copy(VA.base);VA.r.position.y-=.12*adsK;VA.r.position.z-=.07*adsK;   // mirando com a pistola: ombros mais baixos, o braço vem de baixo e não tampa a arma
  camera.updateMatrixWorld(true);gun.updateMatrixWorld(true);
  const D=v=>new THREE.Vector3(v[0],v[1],v[2]).normalize().transformDirection(gun.matrixWorld);
  const B=VA.B,hl=s=>B[s+'Hand'].getWorldPosition(new THREE.Vector3()).distanceTo(B[s+'HandMiddle1'].getWorldPosition(new THREE.Vector3()));   // tamanho real da mão
  const wrist=(h,g,s)=>gun.localToWorld(h.position.clone().add(new THREE.Vector3(g.o[0],g.o[1],g.o[2])).addScaledVector(new THREE.Vector3(g.f[0],g.f[1],g.f[2]).normalize(),-hl(s)));
  const gR=gripOf('R');curlHand('Right',gR);
  const pk=adsK,pole=x=>camera.localToWorld(new THREE.Vector3(x*(1-.6*pk),-.9-.9*pk,.3-.2*pk));   // mirando: cotovelos para baixo, antebraços saem por baixo da tela
  ikArm('Right',wrist(hR,gR,'Right'),pole(.6),[D(gR.f),D(gR.t)]);
  const gL=hL.visible&&gripOf('L');
  if(gL){curlHand('Left',gL);ikArm('Left',wrist(hL,gL,'Left'),pole(-.6),[D(gL.f),D(gL.t)])}
  else ikArm('Left',camera.localToWorld(new THREE.Vector3(-.3,-.75,.15)),camera.localToWorld(new THREE.Vector3(-.6,-.9,.3)),null); // mão esquerda fora da tela
}
// celular: texturas do soldado em 1024 px (as originais têm 2048; 4x menos memória de vídeo)
function shrinkTex(t){const im=t.image,M=1024;if(!im||im.width<=M)return;const c=document.createElement('canvas');c.width=c.height=M;c.getContext('2d').drawImage(im,0,0,M,M);t.image=c;t.needsUpdate=true}
function prepMixamo(gl,tdir){                                        // tdir: pasta das texturas Packed*_Diffuse/Normal (sem ela, cores lisas)
  const sk=o=>Object.assign(o,{skinning:true}),cor=c=>sk(new THREE.MeshStandardMaterial({color:c,roughness:.85,envMapIntensity:.3}));
  const M={Body:cor(0xb98767),Tops:sk(new THREE.MeshStandardMaterial({map:camoT,roughness:.9,envMapIntensity:.3})),Bottoms:sk(new THREE.MeshStandardMaterial({map:camoT,color:0xbfb8a0,roughness:.9,envMapIntensity:.3})),
    Shoes:cor(0x1d1915),Gloves:cor(0x242424),Eyewear:sk(GM.lens.clone())};
  const root=new THREE.Group();gl.scene.scale.setScalar(.01);root.add(gl.scene);   // cm → m
  const TX={},tex=n=>{if(!TX[n]){const t=new THREE.TextureLoader().load(tdir+n+'.png',isTouch?shrinkTex:undefined);if(/Diffuse/.test(n))t.encoding=THREE.sRGBEncoding;t.anisotropy=4;TX[n]=t}return TX[n]};
  const PK={};const packed=m=>{const k=(/Packed\D*(\d)/.exec(m.name)||[])[1];if(k==null)return null;   // personagem com texturas próprias (ex.: soldado russo)
    return PK[k]=PK[k]||sk(new THREE.MeshStandardMaterial({map:tex('Packed'+k+'_Diffuse'),normalMap:tex('Packed'+k+'_Normal'),roughness:.8,envMapIntensity:.35}))};
  root.traverse(o=>{if(!o.isSkinnedMesh)return;const pm=tdir&&packed(o.material);
    if(pm&&o.name!=='default'){o.material=pm;o.castShadow=true;o.frustumCulled=false}                  // 'default' = cílios (precisam de transparência)
    else if(!tdir&&M[o.name]){o.material=M[o.name];o.castShadow=true;o.frustumCulled=false}else o.visible=false}); // tático: boné, olhos e cílios somem; capacete por cima
  root.updateMatrixWorld(true);
  const B={};root.traverse(o=>{if(o.isBone)B[o.name.replace(MX,'')]=o});
  const wp=n=>B[n].getWorldPosition(new THREE.Vector3()),V=(x,y,z)=>new THREE.Vector3(x,y,z);
  const put=(bone,o,pos,name)=>{o.position.copy(pos);if(name)o.name=name;root.add(o);o.updateMatrixWorld();B[bone].attach(o);return o};
  const part=(geo,m,s,pos,bone,name)=>{const o=new THREE.Mesh(geo,m);o.scale.set(s[0],s[1],s[2]);o.castShadow=true;return put(bone,o,pos,name)};
  // capacete no lugar do boné (o crânio vai de ~3 cm abaixo a ~16 cm acima do osso Head)
  const hat=tdir&&root.getObjectByName('Hats');
  if(hat){const c=new THREE.Mesh(hat.geometry,hat.material.clone());c.material.skinning=false;c.castShadow=true;   // chapéu vira peça rígida presa à cabeça (pode voar no headshot)
    hat.matrixWorld.decompose(c.position,c.quaternion,c.scale);hat.visible=false;
    c.geometry.computeBoundingBox();const hc=c.geometry.boundingBox.getCenter(new THREE.Vector3());c.updateMatrix();c.position.copy(hc).applyMatrix4(c.matrix);c.geometry=c.geometry.clone().translate(-hc.x,-hc.y,-hc.z); // origem no centro do capacete (vinha nos pés: solto, ele ficava no ar)
    c.name='capacete';root.add(c);c.updateMatrixWorld();B.Head.attach(c)}
  else{const hp=wp('Head');part(EG.helm,EM.helm,[.13,.118,.145],V(hp.x,hp.y+.068,hp.z+.012),'Head','capacete')}
  // caixas de acerto nos ossos
  const HB=new THREE.MeshBasicMaterial({visible:false}),YA=V(0,1,0);
  const hb=(a,b,w)=>{const A=wp(a),d=wp(b).sub(A),o=new THREE.Mesh(BOX,HB);o.scale.set(w,d.length()+w*.4,w);o.quaternion.setFromUnitVectors(YA,d.clone().normalize());o.userData={hb:'body'};return put(a,o,A.clone().addScaledVector(d,.5))};
  const hd=new THREE.Mesh(SPH,HB);hd.scale.setScalar(.14);hd.userData={hb:'head'};put('Head',hd,wp('Head').add(V(0,.09,.02)));
  hb('Hips','Neck',.36);
  ['Left','Right'].forEach(s=>{hb(s+'Arm',s+'ForeArm',.12);hb(s+'ForeArm',s+'Hand',.1);hb(s+'UpLeg',s+'Leg',.16);hb(s+'Leg',s+'Foot',.13)});
  // fuzil: cabo na mão direita, cano apontando para a mão esquerda na pose de mira
  const C=n=>gl.animations.find(c=>c.name===n),mx=new THREE.AnimationMixer(root);mx.clipAction(C('idle')).play();mx.update(0);root.updateMatrixWorld(true);
  const rh=wp('RightHand'),lh=wp('LeftHand'),rg=new THREE.Group(),rifle=new THREE.Group(),r=makeGun(WP.ak,rifle,true);
  rifle.traverse(o=>{if(o.isMesh)o.castShadow=true});rifle.rotation.y=Math.PI;rifle.scale.setScalar(.85);rifle.position.set(0,.061,.063);rg.add(rifle);
  const mz=new THREE.Object3D();mz.name='boca';mz.position.set(0,.008,r.muzzle);rifle.add(mz);
  rg.position.copy(rh);rg.lookAt(lh.clone().add(lh.clone().sub(rh)));rg.name='fuzil';root.add(rg);rg.updateMatrixWorld();B.RightHand.attach(rg);
  mx.stopAllAction();
  const up=n=>{const c=C(n).clone();c.tracks=c.tracks.filter(t=>MUP.test(t.name.split('.')[0]));return c};   // só tronco e braços
  const S={idle:C('idle'),walk:C('run'),fire:up('fire')};
  if(C('hit'))S.hit=up('hit');['back','crouch','stop'].forEach(k=>{if(C(k))S[k]=C(k)});   // o tatico.glb antigo não tem 'stop'
  return {root,S,
    RB:{P:'Hips',N:'Neck',H:'Head',shL:'LeftArm',elL:'LeftForeArm',haL:'LeftHand',shR:'RightArm',elR:'RightForeArm',haR:'RightHand',hiL:'LeftUpLeg',knL:'LeftLeg',ftL:'LeftFoot',hiR:'RightUpLeg',knR:'RightLeg',ftR:'RightFoot'},
    RBONES:[['Hips','P','N','T'],['LeftArm','shL','elL','T'],['LeftForeArm','elL','haL','T'],['RightArm','shR','elR','T'],['RightForeArm','elR','haR','T'],
      ['LeftUpLeg','hiL','knL','L'],['LeftLeg','knL','ftL','L'],['RightUpLeg','hiR','knR','L'],['RightLeg','knR','ftR','L']],pre:MX};
}
function prepSoldier(root,clips){
  // farda: uma textura camuflada no corpo todo; rosto (balaclava), mãos (luvas) e pés (botas) escurecidos no shader
  // pela posição de repouso do vértice, que não muda com a animação
  const body=new THREE.MeshStandardMaterial({map:camoT,roughness:.9,skinning:true,envMapIntensity:.3});
  body.onBeforeCompile=s=>{
    s.vertexShader='varying vec3 vB;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvB=position;');
    s.fragmentShader='varying vec3 vB;\n'+s.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\nif(vB.y>1.5)diffuseColor.rgb=vec3(.032,.033,.03);else if(abs(vB.x)>.64)diffuseColor.rgb=vec3(.018);else if(vB.y<.14)diffuseColor.rgb=vec3(.03,.024,.018);');
  };
  root.traverse(o=>{if(o.isSkinnedMesh){if(/SuperHero/i.test(o.name)){o.material=body;o.castShadow=true;o.frustumCulled=false}else o.visible=false}}); // olhos e sobrancelhas ficam sob a balaclava
  root.updateMatrixWorld(true);
  const B={};root.traverse(o=>{if(o.isBone)B[o.name]=o});
  const wp=n=>B[n].getWorldPosition(new THREE.Vector3());
  const put=(bone,o,pos,name)=>{o.position.copy(pos);if(name)o.name=name;root.add(o);o.updateMatrixWorld();B[bone].attach(o);return o};
  const part=(geo,m,s,pos,bone,name)=>{const o=new THREE.Mesh(geo,m);o.scale.set(s[0],s[1],s[2]);o.castShadow=true;return put(bone,o,pos,name)};
  const V=(x,y,z)=>new THREE.Vector3(x,y,z);
  // equipamento preso aos ossos (posições medidas na pose de repouso do modelo)
  part(EG.helm,EM.helm,[.14,.125,.155],V(0,1.715,-.01),'Head','capacete');
  part(EG.box,GM.lens,[.17,.045,.03],V(0,1.705,.095),'Head');
  part(EG.box,EM.vest,[.43,.4,.32],V(0,1.33,-.01),'spine_03');
  for(let k=-1;k<=1;k++)part(EG.box,EM.vest,[.105,.13,.06],V(k*.13,1.22,.17),'spine_03');
  part(EG.box,EM.gear,[.13,.06,.03],V(.1,1.45,.165),'spine_03');
  part(EG.box,EM.gear,[.3,.34,.12],V(0,1.36,-.22),'spine_03');
  part(EG.box,EM.gear,[.37,.06,.28],V(0,1.0,-.01),'pelvis');
  ['l','r'].forEach(s=>{const k=wp('calf_'+s),f=wp('foot_'+s);
    part(EG.box,EM.gear,[.11,.11,.05],V(k.x,k.y,k.z+.08),'calf_'+s);
    part(EG.box,EM.boot,[.12,.12,.27],V(f.x,.06,f.z+.05),'foot_'+s)});
  // caixas de acerto invisíveis presas aos ossos (o raycast numa malha animada usaria a pose de repouso)
  const HB=new THREE.MeshBasicMaterial({visible:false}),YA=new THREE.Vector3(0,1,0);
  const hb=(a,b,w,kind)=>{const A=wp(a),Bp=b?wp(b):A.clone().add(V(0,.25,0)),o=new THREE.Mesh(BOX,HB),d=Bp.clone().sub(A);
    o.scale.set(w,d.length()+w*.4,w);o.quaternion.setFromUnitVectors(YA,d.clone().normalize());o.userData={hb:kind};return put(a,o,A.clone().addScaledVector(d,.5))};
  const hd=new THREE.Mesh(SPH,HB);hd.scale.setScalar(.14);hd.userData={hb:'head'};put('Head',hd,V(0,1.71,0));
  hb('pelvis','neck_01',.36,'body');
  ['l','r'].forEach(s=>{hb('upperarm_'+s,'lowerarm_'+s,.12,'body');hb('lowerarm_'+s,'hand_'+s,.1,'body');hb('thigh_'+s,'calf_'+s,.16,'body');hb('calf_'+s,'foot_'+s,.13,'body')});
  // animações: pernas andando/paradas e tronco sempre mirando (clipes filtrados por grupo de ossos)
  const C=n=>clips.find(c=>c.name===n),sub=(c,up)=>{c=c.clone();c.tracks=c.tracks.filter(t=>UPPER.test(t.name.split('.')[0])===up);return c};
  const S={aim:sub(C('Pistol_Aim_Neutral'),true),walk:sub(C('Jog_Fwd_Loop')||C('Walk_Loop'),false),idle:sub(C('Idle_Loop'),false)};
  // fuzil na mão direita, encaixado na pose de mira
  const mx=new THREE.AnimationMixer(root);mx.clipAction(S.aim).play();mx.update(0);root.updateMatrixWorld(true);
  const rifle=new THREE.Group(),r=makeGun(WP.ak,rifle,true);rifle.traverse(o=>{if(o.isMesh)o.castShadow=true});
  rifle.rotation.y=Math.PI;rifle.scale.setScalar(.85);rifle.name='fuzil';
  const mz=new THREE.Object3D();mz.name='boca';mz.position.set(0,.008,r.muzzle);rifle.add(mz);
  const hr=wp('hand_r');put('hand_r',rifle,hr.add(V(0,.061,.063)));
  mx.stopAllAction();
  return {root,S,RB,RBONES,pre:''};
}
function makeSoldier3D(){
  const g=THREE.SkeletonUtils.clone(SOLD.root),holder=new THREE.Group();holder.add(g);
  const bones={},hit=[];let head=null;g.traverse(o=>{if(o.isBone)bones[o.name.replace(SOLD.pre,'')]=o;if(o.userData&&o.userData.hb){hit.push(o);if(o.userData.hb==='head')head=o}});
  const mx=new THREE.AnimationMixer(g),A={};for(const k in SOLD.S){A[k]=mx.clipAction(SOLD.S[k]);A[k].play()}
  A.walk.time=Math.random()*A.walk.getClip().duration;
  ['fire','hit','stop'].forEach(k=>{if(A[k]){A[k].setLoop(THREE.LoopOnce,1);A[k].clampWhenFinished=false;A[k].stop()}});   // disparadas uma vez
  if(A.hit)A.hit.timeScale=1.6;
  ['back','crouch'].forEach(k=>{if(A[k])A[k].setEffectiveWeight(0)});
  const muzzle=g.getObjectByName('boca');enemyGun(muzzle);
  return {g:holder,mx,A,bones,hit,head,helm:g.getObjectByName('capacete'),gun:g.getObjectByName('fuzil'),muzzle};
}
// arma do inimigo: um dos modelos 3D de arma longa do jogador (sem AWP e pistolas, que não combinam com as animações de fuzil)
const EGMDL=['ak','ak12','fuzil','bizon','pmx'];
function enemyGun(mz){
  const ok=EGMDL.filter(id=>MDL[id].tpl);if(!mz||!ok.length)return;  // modelos ainda carregando: fica o fuzil procedural
  const md=MDL[ok[Math.floor(Math.random()*ok.length)]],r=mz.parent;
  r.children.filter(o=>o!==mz).forEach(o=>r.remove(o));
  const m=md.tpl.clone();m.traverse(o=>{if(o.isMesh)o.castShadow=true});r.add(m);mz.position.z=md.muzzle;
}
// ragdoll do soldado 3D: as mesmas partículas, mas cada osso do esqueleto segue o seu par
const RB={P:'pelvis',N:'neck_01',H:'Head',shL:'upperarm_l',elL:'lowerarm_l',haL:'hand_l',shR:'upperarm_r',elR:'lowerarm_r',haR:'hand_r',
  hiL:'thigh_l',knL:'calf_l',ftL:'foot_l',hiR:'thigh_r',knR:'calf_r',ftR:'foot_r'};
const RBONES=[['pelvis','P','N','T'],['upperarm_l','shL','elL','T'],['lowerarm_l','elL','haL','T'],['upperarm_r','shR','elR','T'],['lowerarm_r','elR','haR','T'],
  ['thigh_l','hiL','knL','L'],['calf_l','knL','ftL','L'],['thigh_r','hiR','knR','L'],['calf_r','knR','ftR','L']];
function spawnWave(){
  spawnPickups();
  const n=Math.min(3+wave*2,16);
  $('wv').textContent='Onda '+wave;
  for(let i=0;i<n;i++){
    let x,z,tries=0;
    do{x=(Math.random()*2-1)*(HALF-4);z=(Math.random()*2-1)*(HALF-4);tries++}
    while(tries<40&&(Math.hypot(x-P.x,z-P.z)<HALF*.55||inBox(x,z,.7)));
    const s=SOLD?makeSoldier3D():makeSoldier();
    s.g.position.set(x,0,z);s.g.rotation.order='YXZ';scene.add(s.g);
    const e={g:s.g,j:s.j,mx:s.mx,A:s.A,bones:s.bones,muzzle:s.muzzle,helm:s.helm,gun:s.gun,x,z,ammo:5+Math.floor(Math.random()*4),rl:0,mag:s.gun&&s.gun.getObjectByName('pente'),hp:(3+Math.floor(wave/2))*10,speed:2.2+Math.random()*.8+Math.min(wave*.12,1.6),fire:1+Math.random()*2.5,ph:Math.random()*6,hitT:0,meshes:[]};
    if(s.hit)s.hit.forEach(o=>{o.userData={owner:e,head:o===s.head};e.meshes.push(o)});   // 3D: caixas de acerto invisíveis
    else s.g.traverse(o=>{if(o.isMesh&&!isIn(o,s.gun)){o.userData={owner:e,head:isIn(o,s.head)};e.meshes.push(o)}});
    enemies.push(e);
  }
}
function isIn(o,p){for(let q=o;q;q=q.parent)if(q===p)return true;return false}

// recarga do inimigo (3D): inclina a arma, o pente cai no chão, a mão esquerda busca outro e encaixa (IK no braço)
const ERL=2.6,_eq=new THREE.Quaternion(),_ex=new THREE.Vector3(1,0,0),_ez=new THREE.Vector3(0,0,1);
function enemyReload(e){
  const g=e.gun;if(!g)return;if(!g.userData.q0)g.userData.q0=g.quaternion.clone();
  const p=e.rl>0?1-e.rl/ERL:1,tilt=sm(0,.12,p)*(1-sm(.85,1,p));
  g.quaternion.copy(g.userData.q0).multiply(_eq.setFromAxisAngle(_ez,tilt*.6));   // gira a arma de lado
  const m=e.mag;if(!m)return;if(!m.userData.r0)m.userData.r0=m.position.clone();
  const out=sm(.12,.26,p),ins=sm(.55,.75,p),dy=p<.28?-out*.22:-.22*(1-ins);
  m.position.copy(m.userData.r0);m.position.y+=dy;m.visible=p<.28||p>=.5;
  if(e.rl>0&&p>=.28&&!e.dr){e.dr=1;const c=m.clone();m.getWorldPosition(c.position);m.getWorldQuaternion(c.quaternion);m.getWorldScale(c.scale);scene.add(c);
    drops.push({m:c,v:new THREE.Vector3((Math.random()-.5)*.6,-.4,(Math.random()-.5)*.6),w:new THREE.Vector3(3,0,2),t:0,rx:0,rz:Math.PI/2,fy:.016});if(drops.length>14){scene.remove(drops[0].m);drops.shift()}}
  const k=sm(.08,.2,p)*(1-sm(.75,.9,p));if(k<=0||!e.bones)return;
  const R=SOLD.RB,B=e.bones,up=B[R.shL],lo=B[R.elL],ha=B[R.haL];if(!up||!lo||!ha)return;
  const G=m.userData.grab||{x:0,y:-.1,z:0},want=(m.updateWorldMatrix(true,false),m.localToWorld(new THREE.Vector3(G.x,G.y,G.z))),down=sm(.28,.4,p)*(1-sm(.42,.55,p));
  want.y-=down*.35;                                                  // entre tirar e pôr: a mão desce até o colete
  const hp=ha.getWorldPosition(new THREE.Vector3()),tgt=hp.clone().lerp(want,k);
  const a=up.getWorldPosition(new THREE.Vector3()),pole=a.clone().add(new THREE.Vector3(0,-1,0)).addScaledVector(new THREE.Vector3(Math.cos(e.g.rotation.y),0,-Math.sin(e.g.rotation.y)),.5);
  const b=lo.getWorldPosition(new THREE.Vector3()),L1=a.distanceTo(b),L2=b.distanceTo(hp),dir=tgt.clone().sub(a),d=Math.min(dir.length(),L1+L2-1e-4);dir.normalize();
  const x=(L1*L1-L2*L2+d*d)/(2*d),h=Math.sqrt(Math.max(0,L1*L1-x*x)),n=pole.sub(a);n.addScaledVector(dir,-n.dot(dir)).normalize();
  aimBone(up,b,a.clone().addScaledVector(dir,x).addScaledVector(n,h));aimBone(lo,ha.getWorldPosition(new THREE.Vector3()),a.clone().addScaledVector(dir,d));
}
// inimigo só atira se enxergar o jogador: raio dos olhos dele até o peito (ou, se o peito estiver coberto, até a cabeça)
// contra paredes, caixas, telhados e valas. Sem isso, tiros de trás das paredes denunciavam onde ele estava.
const _sr=new THREE.Raycaster(),_so=new THREE.Vector3(),_sd=new THREE.Vector3();
function sightTo(e,y){const ey=1.5-.4*(e.wc||0);_so.set(e.x,ey,e.z);_sd.set(P.x-e.x,y-ey,P.z-e.z);const L=_sd.length();if(L<.5)return true;
  _sd.multiplyScalar(1/L);_sr.set(_so,_sd);_sr.far=L-.35;return !_sr.intersectObjects(solids,false).length}
function canSee(e){const chest=P.y+1.3-.5*crK,head=camera.position.y-.05;e.aimY=sightTo(e,chest)?chest:sightTo(e,head)?head:null;return e.aimY!==null}
let ESHOT=0;   // tiros dos inimigos (só para o ?debug)
function enemyShoot(e){ESHOT++;
  const m=makeTracer(2,.03);
  const ry=e.g.rotation.y,cs=Math.cos(ry),sn=Math.sin(ry);let mx=e.x+.14*cs+.98*sn,my=1.39,mz=e.z-.14*sn+.98*cs;
  if(e.muzzle){const w=e.muzzle.getWorldPosition(new THREE.Vector3());mx=w.x;my=w.y;mz=w.z}
  if(e.A&&e.A.fire)e.A.fire.reset().play();                          // coice do tiro (só no soldado tático)   // boca do fuzil do modelo 3D
  m.position.set(mx,my,mz);scene.add(m);
  const head=e.aimY!=null&&e.aimY>P.y+1.35-.5*crK,ty=(e.aimY!=null?e.aimY:P.y+1.3-.5*crK)+(Math.random()-.5)*(head?.25:.6);   // só a cabeça à vista: mira nela
  const tx=P.x+(Math.random()-.5)*1.4,tz=P.z+(Math.random()-.5)*1.4;
  const v=new THREE.Vector3(tx-mx,ty-my,tz-mz).normalize().multiplyScalar(55+Math.min(wave,8)*2);   // bala de verdade é rápida: traçante a ~60 m/s
  m.lookAt(m.position.clone().add(v));eflash(m.position,v.clone().normalize());sparks(m.position,v.clone().normalize(),3,6);
  shots.push({m,v,life:4});gunshot(.3,'r',m.position);
}
const fx=[],dying=[];
// ---------- ragdoll (física Verlet, sem biblioteca) ----------
// Ao morrer, cada junta do soldado vira uma partícula; restrições de distância mantêm o corpo inteiro
// (tronco e cabeça rígidos, braços e pernas articulados). Cada parte do corpo segue o par de partículas dela.
const RJ=['P','N','H','shL','elL','haL','shR','elR','haR','hiL','knL','ftL','hiR','knR','ftR'];
const RR={P:.14,N:.12,H:.12,shL:.08,elL:.06,haL:.05,shR:.08,elR:.06,haR:.05,hiL:.1,knL:.08,ftL:.07,hiR:.1,knR:.08,ftR:.07};
const RIGID=['P','N','H','shL','shR','hiL','hiR'];
const LINKS=[['shL','elL'],['elL','haL'],['shR','elR'],['elR','haR'],['hiL','knL'],['knL','ftL'],['hiR','knR'],['knR','ftR']];
const MINL=[['hiL','ftL',.62],['hiR','ftR',.62],['shL','haL',.45],['shR','haR',.45],['P','haL',.3],['P','haR',.3]]; // não deixa dobrar demais
const BONES=[['torso','P','N','T'],['head','N','H','T'],['shL','shL','elL','T'],['elL','elL','haL','T'],['shR','shR','elR','T'],['elR','elR','haR','T'],
  ['hipL','hiL','knL','L'],['kneeL','knL','ftL','L'],['hipR','hiR','knR','L'],['kneeR','knR','ftR','L']];
const RDT=1/60,_ra=new THREE.Vector3(),_rx=new THREE.Vector3(),_ry=new THREE.Vector3(),_rz=new THREE.Vector3(),_rm=new THREE.Matrix4();
function rFrame(d,A,B,s,out){                                        // base ortonormal: y ao longo do osso, x para o lado do corpo
  const p=d.p;_ry.subVectors(p[B].c,p[A].c).normalize();
  if(s==='T')_rx.subVectors(p.shR.c,p.shL.c);else _rx.subVectors(p.hiR.c,p.hiL.c);
  _rx.addScaledVector(_ry,-_rx.dot(_ry));if(_rx.lengthSq()<1e-8)_rx.set(1,0,0);_rx.normalize();_rz.crossVectors(_rx,_ry);
  return out.makeBasis(_rx,_ry,_rz).setPosition(p[A].c);
}
function ragdoll(e,dir,pt,force){
  const j=e.j;e.g.updateMatrixWorld(true);
  const W=(o,x,y,z)=>o.localToWorld(new THREE.Vector3(x,y,z));
  let pos;
  if(e.bones){pos={};for(const k in SOLD.RB)pos[k]=e.bones[SOLD.RB[k]].getWorldPosition(new THREE.Vector3());pos.H.y+=.13;e.mx.stopAllAction()}
  else pos={P:W(j.torso,0,0,0),N:W(j.torso,0,.67,0),H:W(j.head,0,.13,0),
    shL:W(j.shL,0,0,0),elL:W(j.elL,0,0,0),haL:W(j.elL,0,-.3,0),shR:W(j.shR,0,0,0),elR:W(j.elR,0,0,0),haR:W(j.elR,0,-.3,0),
    hiL:W(j.hipL,0,0,0),knL:W(j.kneeL,0,0,0),ftL:W(j.kneeL,0,-.45,.04),hiR:W(j.hipR,0,0,0),knR:W(j.kneeR,0,0,0),ftR:W(j.kneeR,0,-.45,.04)};
  const d={p:{},c:[],t:0,acc:0,bones:[]};
  for(const k of RJ){                                                // impulso: mais forte perto do ponto atingido
    const c=pos[k],w=Math.exp(-c.distanceToSquared(pt)/.12),v=dir.clone().multiplyScalar(force*(.35+w));v.y+=force*.12*(.5+w);
    d.p[k]={c,o:c.clone().addScaledVector(v,-RDT),r:RR[k]};
  }
  const link=(a,b,min)=>d.c.push({a:d.p[a],b:d.p[b],L:d.p[a].c.distanceTo(d.p[b].c)*(min||1),min:!!min});
  for(let i=0;i<RIGID.length;i++)for(let k=i+1;k<RIGID.length;k++)link(RIGID[i],RIGID[k]);
  LINKS.forEach(l=>link(l[0],l[1]));MINL.forEach(l=>link(l[0],l[1],l[2]));
  for(const b of (e.bones?SOLD.RBONES:BONES)){const o=e.bones?e.bones[b[0]]:j[b[0]];d.bones.push({o,A:b[1],B:b[2],s:b[3],bone:!!e.bones,off:rFrame(d,b[1],b[2],b[3],new THREE.Matrix4()).invert().multiply(o.matrixWorld)})}
  if(e.mag&&e.mag.userData.r0){e.mag.position.copy(e.mag.userData.r0);e.mag.visible=true}   // morreu recarregando: a arma cai com o pente
  if(e.gun){scene.attach(e.gun);drops.push({m:e.gun,v:dir.clone().multiplyScalar(1.6).add(new THREE.Vector3(0,1.2,0)),w:new THREE.Vector3(2,0,3),t:0,fy:.05,rx:0})} // o fuzil cai solto
  if(e.bones)d.root=e.g;                                             // 3D: os ossos ficam no esqueleto e seguem as partículas
  else{d.bones.forEach(b=>scene.attach(b.o));scene.remove(e.g)}   // procedural: cada parte vira um objeto solto na cena
  return d;
}
function stepRag(d){
  const G=-14*RDT*RDT;
  for(const k in d.p){const q=d.p[k],c=q.c,vx=(c.x-q.o.x)*.99,vy=(c.y-q.o.y)*.99,vz=(c.z-q.o.z)*.99;q.o.copy(c);c.x+=vx;c.y+=vy+G;c.z+=vz}
  for(let it=0;it<8;it++){
    for(const s of d.c){const a=s.a.c,b=s.b.c;_ra.subVectors(b,a);const L=_ra.length()||1e-6;if(s.min&&L>=s.L)continue;const k=(L-s.L)/L*.5;a.addScaledVector(_ra,k);b.addScaledVector(_ra,-k)}
    for(const k in d.p){const q=d.p[k],c=q.c,r=q.r,Lw=HALF-r;
      if(c.y<r)c.y=r;
      c.x=Math.max(-Lw,Math.min(Lw,c.x));c.z=Math.max(-Lw,Math.min(Lw,c.z));
      for(const o of boxes){if(c.y-r<o.h&&c.x>o.minX-r&&c.x<o.maxX+r&&c.z>o.minZ-r&&c.z<o.maxZ+r){   // sai pela face mais próxima
        const a1=c.x-o.minX+r,a2=o.maxX+r-c.x,b1=c.z-o.minZ+r,b2=o.maxZ+r-c.z,up=o.h+r-c.y,m=Math.min(a1,a2,b1,b2,up);
        if(m===up)c.y=o.h+r;else if(m===a1)c.x=o.minX-r;else if(m===a2)c.x=o.maxX+r;else if(m===b1)c.z=o.minZ-r;else c.z=o.maxZ+r}}
    }
  }
  for(const k in d.p){const q=d.p[k];if(q.c.y<=q.r+.002){q.o.x=LERP(q.o.x,q.c.x,.35);q.o.z=LERP(q.o.z,q.c.z,.35)}} // atrito no chão
}
const _rmi=new THREE.Matrix4();
function poseRag(d){for(const b of d.bones){rFrame(d,b.A,b.B,b.s,_rm).multiply(b.off);
  if(b.bone){b.o.parent.updateWorldMatrix(true,false);_rm.premultiply(_rmi.copy(b.o.parent.matrixWorld).invert())}   // osso: mundo → local do pai
  _rm.decompose(b.o.position,b.o.quaternion,b.o.scale)}}
const BODYMAX=30;   // corpos que ficam no chão no modo bodycam (os mais antigos saem)
function clearRag(d){d.bones.forEach(b=>{if(!b.bone)scene.remove(b.o)});if(d.root)scene.remove(d.root)}
const dGeo=new THREE.BoxGeometry(1,1,1),sGeo=new THREE.SphereGeometry(1,10,8);
const dm=[0x4f5d3e,0x2b2e2a,0xc59a7c,0x6b7280,0xff8a3d].map(c=>new THREE.MeshBasicMaterial({color:c}));
const spMat=new THREE.MeshBasicMaterial({color:0xffc04a}),brass=new THREE.MeshBasicMaterial({color:0xc9a227});
const holes=[],holeG=new THREE.PlaneGeometry(.05,.05),holeM=new THREE.MeshBasicMaterial({map:TX_HOLE,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});   // furo pequeno com lascas em volta
function burst(pos,n,mats,spd,size,grav,life,dir){
  for(let i=0;i<n;i++){
    const m=new THREE.Mesh(dGeo,mats[i%mats.length]);
    m.position.copy(pos);const s=size*(.5+Math.random());m.scale.setScalar(s);scene.add(m);
    const sp=spd*(.4+Math.random()*.8);let v;
    if(dir){v=dir.clone().add(new THREE.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).multiplyScalar(.5)).normalize().multiplyScalar(sp)}
    else{const a=Math.random()*6.283,u=Math.random()*2-1,r=Math.sqrt(1-u*u);v=new THREE.Vector3(Math.cos(a)*r*sp,Math.abs(u)*sp+spd*.3,Math.sin(a)*r*sp)}
    fx.push({m,v,life,max:life,g:grav,s});
  }
}
function boom(pos,col,sz,life,op,rise){
  const m=new THREE.Sprite(new THREE.SpriteMaterial({map:TX_SMOKE,color:col||0xff9a3a,transparent:true,opacity:op||.8,depthWrite:false,rotation:Math.random()*6.28}));
  m.position.copy(pos);scene.add(m);fx.push({m,v:new THREE.Vector3(0,rise||0,0),life:life||.35,max:life||.35,g:0,s:sz||1,f:true,op:op||.8});
}
function updateFx(dt){
  for(let i=dying.length-1;i>=0;i--){                                // ragdoll: física por 4 s, depois afunda e some
    const d=dying[i];d.t+=dt;                                        // (no modo bodycam o corpo fica no chão: até BODYMAX corpos)
    if(d.t<4){d.acc+=dt;let n=0;while(d.acc>=RDT&&n++<5){stepRag(d);d.acc-=RDT}}
    else if(!BODY)for(const k in d.p)d.p[k].c.y-=dt*.3;
    if(d.t<4.3||!BODY)poseRag(d);                                    // parado: não precisa recalcular a pose
    if(d.t>5.5&&!BODY){clearRag(d);dying.splice(i,1)}
  }
  while(BODY&&dying.length>BODYMAX){clearRag(dying[0]);dying.shift()}
  for(let i=fx.length-1;i>=0;i--){
    const f=fx[i];f.life-=dt;const t=Math.max(0,f.life/f.max);
    if(f.f){f.m.scale.setScalar((.4+(1-t)*2.4)*f.s);f.m.material.opacity=t*f.op;f.m.position.addScaledVector(f.v,dt)}
    else{
      f.v.y-=f.g*dt;f.m.position.addScaledVector(f.v,dt);
      if(f.m.position.y<.05){f.m.position.y=.05;f.v.multiplyScalar(.5);f.v.y=Math.abs(f.v.y)*.3}
      f.m.rotation.x+=dt*7;f.m.rotation.z+=dt*5;f.m.scale.setScalar(f.s*Math.min(1,t*2.5));
    }
    if(f.life<=0){scene.remove(f.m);if(f.f)f.m.material.dispose();fx.splice(i,1)}
  }
}
function kill(e,hs,dir,pt,force){                                  // dir/pt/force: direção, ponto e força do golpe (ragdoll)
  enemies.splice(enemies.indexOf(e),1);
  if(!dir)dir=new THREE.Vector3(e.x-P.x,0,e.z-P.z).normalize();if(!pt)pt=new THREE.Vector3(e.x,1.2,e.z);
  if(hs){                                                            // headshot: o capacete voa e fica no chão
    const h=e.helm,c=new THREE.Mesh(h.geometry,h.material);   // malha nova: clone() copiaria userData.owner (circular)
    h.getWorldPosition(c.position);h.getWorldQuaternion(c.quaternion);h.getWorldScale(c.scale);h.visible=false;c.castShadow=true;scene.add(c);
    const a=new THREE.Vector3(e.x-P.x,0,e.z-P.z).normalize();
    drops.push({m:c,v:new THREE.Vector3(a.x*2.6+(Math.random()-.5),3.4,a.z*2.6+(Math.random()-.5)),w:new THREE.Vector3(7,0,5),t:0,fy:Math.max(.03,-new THREE.Box3().setFromBufferAttribute(c.geometry.attributes.position).min.y*c.scale.y),rx:0});
    const p=e.g.position.clone();p.y=1.75;bloodFx(p,dir.clone().setY(.3).normalize(),2.5)}
  dying.push(ragdoll(e,dir,pt,force||3));
  setTimeout(()=>splat(e.x+dir.x*.9,e.z+dir.z*.9,1+Math.random()*.5),700);   // poça onde o corpo cai
  score+=hs?150:100;money+=hs?150:100;nz({type:'lowpass',f:380,v:.12,d:.3,at:.45,rv:.1});   // corpo caindo
}

// ---------- jogador ----------
function shoot(){
  if(!alive||paused||reloading||cool>0)return;
  if(cw.gr)return;
  if(cw.k){stab();return}
  if(ammo<=0){if(reserve>0)doReload();else{cool=.3;clk(1100,.05)}return}   // gatilho seco
  ammo--;cool=cw.cd;kick=1;flashT=.07;gunshot(cw.q,cw.sc?'s':cw.cat==='p'?'p':'r');if(!cw.auto)firing=false;
  flash.scale.setScalar(.75+Math.random()*.6);flash.rotation.z=Math.random()*6.28;
  const mp=new THREE.Vector3(),cd=new THREE.Vector3();flash.getWorldPosition(mp);camera.getWorldDirection(cd);
  sparks(mp,cd,4,9);
  const ep=gun.localToWorld(new THREE.Vector3(.03,.05,-.12));   // janela de ejeção
  ejectShell(ep,new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),cw.id==='awp'||cw.id==='deagle');
  boom(mp,0x8a8a8a,.12,.9,.22,.6);
  const ray=new THREE.Raycaster();
  const sp=(cw.sp+moveAmt*.014+(P.y>0?.03:0))*(1-.65*adsK)*(1-.3*crK)*(1+.8*spK);   // mirando pela arma: bem mais preciso
  pitch=Math.min(1.45,pitch+cw.rc*(.6+Math.random()*.8));yaw+=(Math.random()-.5)*.01;
  let hsHit=false;
  for(let pi=0;pi<cw.n;pi++){
  ray.setFromCamera({x:(Math.random()-.5)*sp*2,y:(Math.random()-.5)*sp*2},camera);
  const hit=ray.intersectObjects(solids.concat(enemies.flatMap(e=>e.meshes)),false)[0];
  if(pi<3)tracer(mp,hit?hit.point:ray.ray.at(120,new THREE.Vector3()),380);
  if(hit&&hit.object.userData.owner){bloodFx(hit.point,ray.ray.direction,cw.dmg>60?1.6:1);wound(hit,ray.ray.direction);if(pi<2)hitFlesh(hit.point)}
  else if(hit&&pi<2)hitHard(hit.point);
  if(hit&&!hit.object.userData.owner&&hit.face){
    const nn=hit.face.normal.clone().transformDirection(hit.object.matrixWorld),dc=new THREE.Mesh(holeG,holeM);
    dc.position.copy(hit.point).addScaledVector(nn,.004);dc.lookAt(dc.position.clone().add(nn));dc.rotateZ(Math.random()*6.28);dc.scale.setScalar(.8+Math.random()*.5);scene.add(dc);holes.push(dc);
    sparks(hit.point,nn,7,4);
    if(holes.length>60)scene.remove(holes.shift());
    boom(hit.point,0x9a9488,.1,.6,.4,.3);
  }
  if(hit&&hit.object.userData.owner){
    const e=hit.object.userData.owner,hs=hit.object.userData.head;
    e.hp-=cw.dmg*(hs?3:1);e.hitT=.12;if(hs)hsHit=true;
    const hm=$('hm');hm.classList.toggle('hs',hs);hm.classList.add('on');hmT=.12;
    if(e.hp<=0)kill(e,hs,ray.ray.direction.clone(),hit.point.clone(),2.4+cw.dmg*.04);
  }
  }
  if(hsHit)hsFx();
  if(ammo===0)doReload();
}
// ---------- luneta (AWP/SSG) ----------
// Botão direito (ou #bZ no toque): zoom 1 → zoom 2 → sem zoom. Com a luneta a arma some, aparece a mira preta
// (#scope) e o mouse fica mais lento. Logo depois do tiro (ferrolho, 55% do intervalo) a luneta sai e volta sozinha.
const SCOPE_FOV=[0,30,11];
// mira pelas miras da pistola (ADS): botão direito segurado (ou #bZ "Mirar" no toque, alterna). Só pistolas.
// posição da arma mirando (y, z no espaço da câmera): pistola esticada à frente; rifles e submetralhadoras com a coronha no ombro
// e a alça de mira no olho. MDL[id].ads={y,z} ajusta uma arma específica.
const ADS_P={y:-.012,z:-.4},ADS_R={y:-.022,z:-.14},FS={};
// altura da massa de mira: ponto mais alto da parte da frente da arma (25% do comprimento), perto do eixo, no espaço do `gun`.
// Mirando, a arma sobe até essa ponta ficar na linha do olho (centro da tela, para onde a bala vai). Calculada uma vez por arma.
function frontSight(){
  if(FS[cw.id]!==undefined)return FS[cw.id];
  gun.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(gun.matrixWorld).invert(),M=new THREE.Matrix4(),v=new THREE.Vector3(),ms=[];
  wm.traverse(o=>{if(o.isMesh&&o.visible&&o.geometry&&o.geometry.attributes.position)ms.push(o)});
  let z0=1e9,z1=-1e9;const pts=[];
  for(const o of ms){M.multiplyMatrices(inv,o.matrixWorld);const P=o.geometry.attributes.position,st=Math.max(1,Math.floor(P.count/40000));
    for(let i=0;i<P.count;i+=st){v.fromBufferAttribute(P,i).applyMatrix4(M);pts.push(v.x,v.y,v.z);if(v.z<z0)z0=v.z;if(v.z>z1)z1=v.z}}
  if(!pts.length)return FS[cw.id]=null;
  const zf=z0+(z1-z0)*.25;let y=-1e9;
  for(let i=0;i<pts.length;i+=3)if(pts[i+2]<zf&&Math.abs(pts[i])<.025&&pts[i+1]>y)y=pts[i+1];
  return FS[cw.id]=y>-1e8?y:null;
}
const adsPos=()=>{const m=MDL[cw.id],b=cw.cat==='p'?ADS_P:ADS_R;if(m&&m.ads)return m.ads;const f=m&&m.tpl?frontSight():null;return f==null?b:{y:-f,z:b.z}};
const canAds=()=>!!(cw&&!cw.k&&!cw.sc&&!cw.x2&&alive&&!reloading&&!paused);   // todas as armas de fogo menos a de luneta e as Berettas duplas
function zoomBtn(){if(cw&&cw.sc)toggleScope();else if(canAds())ads=!ads}
function toggleScope(){if(!cw||!cw.sc||!alive||reloading)return;scopeLv=(scopeLv+1)%3;clk(scopeLv?1300:700,.04)}
function scoped(){return playing&&scopeLv>0&&cw&&cw.sc&&alive&&!paused&&!reloading&&cool<cw.cd*.45}
function updateScope(){
  const on=scoped(),f=on?SCOPE_FOV[scopeLv]*BASEFOV/75:BASEFOV*(1-(cw&&cw.cat==='p'?.16:.22)*adsK)*(1+.07*spK);   // mirando: zoom leve (um pouco mais nos rifles)
  if(camera.fov!==f){camera.fov=f;camera.updateProjectionMatrix()}
  gun.visible=!on;if(VA)VA.r.visible=!on;
  $('scope').classList.toggle('on',on);$('cross').classList.toggle('hide',on||adsK>.4);
  $('bZ').classList.toggle('hide',!(cw&&(cw.sc||canAds())));if(cw)$('bZ').textContent=cw.sc?'Luneta':'Mirar';
}
function doReload(){
  if(reloading||ammo===MAG||reserve<=0||!alive)return;scopeLv=0;
  reloading=true;rt=RL;RS={a0:ammo,empty:ammo===0,dr:0,in:0,rk:0,sh:0,j:0};clk(260,.04);
}
const grens=[],gGeo=new THREE.SphereGeometry(.09,10,8),gMat=new THREE.MeshStandardMaterial({color:0x3d4a2c,roughness:.7});
let GTPL=null,shk=0;   // modelo da granada (assets/armas/grenade.glb) e tremor da câmera
// granada na mão (slot 4): segurar o botão puxa o pino (após GARM s) e carrega a força até GFULL s; soltar lança.
// Soltar antes de puxar o pino cancela. Sem granadas, volta para a arma anterior.
const GARM=.35,GFULL=1.2;
function grenDown(){if(cw&&cw.gr&&alive&&!paused&&gren>0&&grenCD<=0){gHold=0;clk(500,.04)}}
function grenUp(){if(gHold<0)return;const t=gHold;gHold=-1;if(t>=GARM)throwGren(.5+.75*Math.min(1,t/GFULL))}
function throwGren(pw){
  if(!alive||paused||gren<=0||grenCD>0)return;pw=pw||1;
  gren--;grenCD=.8;swing=1;whoosh(.15,.3);
  const d=new THREE.Vector3();camera.getWorldDirection(d);
  const m=GTPL?GTPL.clone():new THREE.Mesh(gGeo,gMat);m.castShadow=true;
  m.position.copy(camera.position).addScaledVector(d,.6);scene.add(m);
  grens.push({m,v:d.multiplyScalar(15*pw).add(new THREE.Vector3(0,3.5*pw,0)),t:1.6});
  if(cur===4&&gren<=0)equip(hasSlot(prevSlot)?prevSlot:2);   // acabaram as granadas: volta para a arma anterior
}
// explosão: clarão → bola de fogo → onda de choque no chão → faíscas e estilhaços → fumaça que sobe e fica → marca queimada
const xfx=[],xLight=new THREE.PointLight(0xffa040,0,18);scene.add(xLight);   // luz fixa: criar luz nova recompila os shaders
const RING_T=fxTex(128,(x,n)=>{const g=x.createRadialGradient(n/2,n/2,n*.3,n/2,n/2,n/2);g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(.7,'rgba(255,255,255,.8)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,n,n)});
const SCORCH_T=fxTex(128,(x,n)=>{const h=n/2;for(let i=0;i<22;i++){const a=Math.random()*6.28,d=h*Math.random()*.6,r=h*(.15+Math.random()*.3),g=x.createRadialGradient(h+Math.cos(a)*d,h+Math.sin(a)*d,0,h+Math.cos(a)*d,h+Math.sin(a)*d,r);
  g.addColorStop(0,'rgba(12,10,8,.5)');g.addColorStop(1,'rgba(12,10,8,0)');x.fillStyle=g;x.fillRect(0,0,n,n)}});
const RING_M=addM(RING_T,0xffb060),SCORCH_M=new THREE.MeshBasicMaterial({map:SCORCH_T,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
// a: aditivo (fogo) ou fumaça; s0→s1 escala; v sobe; t vida
function xPart(p,a,col,s0,s1,t,op,v){const m=new THREE.Sprite(new THREE.SpriteMaterial({map:a?TX_GLOW:TX_SMOKE,color:new THREE.Color(col).multiplyScalar(a&&PP?2.4:1),transparent:true,opacity:op,depthWrite:false,
  blending:a?THREE.AdditiveBlending:THREE.NormalBlending,rotation:Math.random()*6.28,toneMapped:!a}));m.position.copy(p);scene.add(m);xfx.push({m,s0,s1,t,max:t,op,v:v||new THREE.Vector3()})}
function explodeFx(p){
  const g=new THREE.Vector3(p.x,.02,p.z),R=()=>new THREE.Vector3(Math.random()-.5,Math.random()*.6,Math.random()-.5);
  xPart(p,1,0xfff2d0,1.5,6,.14,1);                                                    // clarão
  for(let i=0;i<7;i++)xPart(p.clone().addScaledVector(R(),1.2),1,i%2?0xff7a20:0xffb040,.8,3.2+Math.random()*1.5,.45+Math.random()*.25,.9,R().multiplyScalar(3));   // bola de fogo
  for(let i=0;i<10;i++)xPart(p.clone().addScaledVector(R(),1.6).setY(.4+Math.random()),0,i%3?0x4a4844:0x2e2c2a,1.2,4.5+Math.random()*2,3+Math.random()*2,.75,R().multiplyScalar(.8).setY(.35+Math.random()*.4));   // fumaça
  const r=new THREE.Mesh(PLANE,RING_M.clone());r.rotation.x=-Math.PI/2;r.position.copy(g);scene.add(r);xfx.push({m:r,s0:.5,s1:GR*2.2,t:.35,max:.35,op:1,v:new THREE.Vector3(),ring:1});   // onda de choque
  const sc=new THREE.Mesh(PLANE,SCORCH_M.clone());sc.rotation.x=-Math.PI/2;sc.rotation.z=Math.random()*6.28;sc.position.copy(g);scene.add(sc);xfx.push({m:sc,s0:3.2,s1:3.2,t:14,max:14,op:1,v:new THREE.Vector3(),ring:1,slow:1});   // marca no chão
  sparks(p,new THREE.Vector3(0,1,0),40,16);
  xLight.position.copy(p).setY(p.y+.8);xLight.intensity=PP?60:30;
  shk=Math.max(shk,Math.max(0,1-Math.hypot(P.x-p.x,P.z-p.z)/(GR*3)));
}
function updateXfx(dt){
  xLight.intensity*=Math.exp(-dt*9);
  for(let i=xfx.length-1;i>=0;i--){const f=xfx[i];f.t-=dt;const k=1-Math.max(0,f.t/f.max),e=1-Math.pow(1-k,3);   // cresce rápido e desacelera
    const s=f.s0+(f.s1-f.s0)*e;f.ring?f.m.scale.set(s,s,1):f.m.scale.setScalar(s);f.m.position.addScaledVector(f.v,dt);f.v.multiplyScalar(Math.exp(-dt*1.5));
    f.m.material.opacity=f.op*(f.slow?Math.min(1,f.t/3):(1-k)*(f.m.material.blending===THREE.AdditiveBlending?1:Math.min(1,k*8)));
    if(f.t<=0){scene.remove(f.m);f.m.material.dispose();xfx.splice(i,1)}}
}
function explode(p){
  explodeFx(p);
  burst(p,24,[spMat,dm[4],dm[3]],9,.12,14,1,null);explosionSnd(p);
  let hit=false;
  for(const e of enemies.slice()){
    const d=Math.hypot(e.x-p.x,e.z-p.z);if(d>=GR)continue;
    e.hp-=100*(1-d/GR)+10;e.hitT=.1;hit=true;if(e.hp<=0)kill(e,false,new THREE.Vector3(e.x-p.x,.6,e.z-p.z).normalize(),p.clone(),5+4*(1-d/GR));
  }
  if(hit){const hm=$('hm');hm.classList.remove('hs');hm.classList.add('on');hmT=.12}
  const dp=Math.hypot(P.x-p.x,P.z-p.z);if(dp<GR)hurt(50*(1-dp/GR));
}
function updateGrens(dt){
  for(let i=grens.length-1;i>=0;i--){
    const g=grens[i],p=g.m.position,ox=p.x,oz=p.z;
    g.v.y-=20*dt;p.addScaledVector(g.v,dt);if(CEIL&&p.y>CEIL-.12){p.y=CEIL-.12;g.v.y=-Math.abs(g.v.y)*.3}
    if(p.y<.09){p.y=.09;g.v.y=-g.v.y*.35;g.v.x*=.65;g.v.z*=.65}
    for(const o of boxes)if(p.x>o.minX-.09&&p.x<o.maxX+.09&&p.z>o.minZ-.09&&p.z<o.maxZ+.09&&p.y<o.h+.09){
      if(oy(o,ox,oz)){p.y=o.h+.09;g.v.y=Math.abs(g.v.y)*.35;g.v.x*=.65;g.v.z*=.65}
      else{if(oz>o.minZ-.09&&oz<o.maxZ+.09)g.v.x*=-.4;else g.v.z*=-.4;p.x=ox;p.z=oz}
    }
    const L=HALF-.1;if(Math.abs(p.x)>L){p.x=Math.sign(p.x)*L;g.v.x*=-.4}if(Math.abs(p.z)>L){p.z=Math.sign(p.z)*L;g.v.z*=-.4}
    g.m.rotation.x+=dt*8;g.m.rotation.z+=dt*5;
    g.t-=dt;if(g.t<=0){explode(p.clone());scene.remove(g.m);grens.splice(i,1)}
  }
}
function oy(o,x,z){return x>o.minX-.09&&x<o.maxX+.09&&z>o.minZ-.09&&z<o.maxZ+.09}
let GOD=false;   // só no modo ?debug: jogador não toma dano
function hurt(n){
  if(GOD)return;
  if(armor>0){const a=Math.min(armor,n*.5);armor-=a;n-=a}
  hp-=n;dmgA=1;yaw+=(Math.random()-.5)*.05;pitch=Math.max(-1.45,Math.min(1.45,pitch+.03));nz({type:'lowpass',f:700,v:.35,d:.18});tn({f:85,f2:40,v:.25,d:.18});   // impacto no jogador
  if(hp<=0){
    hp=0;armor=0;alive=false;playing=false;needReset=true;bestW=Math.max(bestW,wave);contW=0;contS=0;save();
    if(document.pointerLockElement)document.exitPointerLock();
    show('Fim de jogo','Você chegou à onda '+wave+' com '+score+' pontos.','Jogar de novo',['shopb','menub']);
  }
}
function hsFx(){const b=$('hsb');b.classList.remove('on');void b.offsetWidth;b.classList.add('on');tn({type:'triangle',f:2350,v:.09,d:.3});tn({f:3620,v:.05,d:.22});nz({type:'bandpass',f:5000,q:2,v:.08,d:.03})}   // "dink" no capacete
function banner(t){const b=$('banner');b.textContent=t;b.classList.add('on');setTimeout(()=>b.classList.remove('on'),1400)}
function reset(){
  enemies.forEach(e=>scene.remove(e.g));enemies.length=0;
  shots.forEach(s=>scene.remove(s.m));shots.length=0;[tracers,sparksL,shells,eflashes,bloodL,splats].forEach(L=>{L.forEach(o=>scene.remove(o.g||o.m));L.length=0});drops.forEach(d=>scene.remove(d.m));drops.length=0;grens.forEach(g=>scene.remove(g.m));grens.length=0;xfx.forEach(f=>{scene.remove(f.m);f.m.material.dispose()});xfx.length=0;xLight.intensity=shk=0;
  if(!wantCont)startKit();                                          // partida nova (onda 1): volta ao inventário inicial
  hp=100;score=wantCont?contS:0;wave=wantCont?contW:0;wantCont=false;spawning=false;reloading=false;refill();load(eq[1]?1:2);
  pickups.forEach(p=>scene.remove(p.g));pickups.length=0;holes.forEach(h=>scene.remove(h));holes.length=0;dying.forEach(clearRag);dying.length=0;fx.forEach(f=>scene.remove(f.m));fx.length=0;
  P.x=MAPS[MAPI].start[0];P.z=MAPS[MAPI].start[1];P.y=0;P.vy=0;yaw=0;pitch=0;needReset=false;crouch=false;crK=spK=0;$('wv').textContent='Onda 1';
}

// ---------- atualização ----------
function update(dt){
  // movimento
  let mx=(keys.KeyD?1:0)-(keys.KeyA?1:0)+jv.x,mz=(keys.KeyW?1:0)-(keys.KeyS?1:0)-jv.y;
  const l=Math.hypot(mx,mz);if(l>1){mx/=l;mz/=l}
  moveAmt=Math.min(l,1);
  if(l>.1&&P.y===0){stepT+=dt;if(stepT>.38/(1+.45*spK)*(1+.5*crK)){stepT=0;stepSnd()}}
  const run=(keys.ShiftLeft||keys.ShiftRight||(isTouch&&Math.hypot(jv.x,jv.y)>.95))&&mz>.5&&!crouch&&!ads&&!firing&&gHold<0&&P.y===0;   // celular: joystick no fim corre
  spK+=((run?1:0)-spK)*Math.min(1,dt*8);crK+=((crouch?1:0)-crK)*Math.min(1,dt*10);
  const sp=(cw.k?7.4:6.2)*(1-.35*adsK)*(1+.6*spK)*(1-.5*crK),fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);
  P.x+=(fx*mz+rx*mx)*sp*dt;P.z+=(fz*mz+rz*mx)*sp*dt;
  resolve(P,.45);
  if(keys.Space&&P.y===0){if(crouch)crouch=false;else P.vy=7}   // agachado, o espaço levanta
  P.vy-=20*dt;P.y+=P.vy*dt;if(P.y<=0){P.y=0;P.vy=0}
  bobT+=dt*(l>.1&&P.y===0?9+4*spK-3*crK:0);
  updateGrens(dt);grenCD-=dt;
  if(gHold>=0){const t0=gHold;gHold+=dt;if(t0<GARM&&gHold>=GARM)clk(900,.06)}   // clique do pino
  cool-=dt;kick=Math.max(0,kick-dt*8);swing=Math.max(0,swing-dt*5);flashT-=dt;hmT-=dt;dmgA=Math.max(0,dmgA-dt*2.2);
  if(hmT<=0)$('hm').classList.remove('on');
  if(reloading){rt-=dt;if(RFZ>=0)rt=Math.max(.001,RL*(1-RFZ));if(rt<=0){reloading=false;const tk=Math.min(MAG-ammo,reserve);ammo+=tk;reserve-=tk}}
  if(firing)shoot();
  shk=Math.max(0,shk-dt*1.6);const sh=shk*shk*.06;   // tremor da explosão
  if(BODY){                                                          // bodycam: no peito, balança mais e acompanha a mira com atraso
    const a=Math.min(1,dt*11);bcYaw+=(yaw-bcYaw)*a;bcPitch+=(pitch-bcPitch)*a;
    camera.position.set(P.x+Math.cos(yaw)*.08,P.y+1.45-.5*crK+Math.abs(Math.sin(bobT))*(.06+.04*spK),P.z-Math.sin(yaw)*.08);
    camera.rotation.y=bcYaw+Math.sin(bobT*.5)*.018+(Math.random()-.5)*sh;camera.rotation.x=bcPitch+Math.abs(Math.sin(bobT))*.025+(Math.random()-.5)*sh;
    camera.rotation.z=Math.sin(bobT*.5)*.035+(yaw-bcYaw)*.6+(Math.random()-.5)*sh;
  }else{
    bcYaw=yaw;bcPitch=pitch;
    camera.position.set(P.x,P.y+1.7-.62*crK+Math.sin(bobT)*(.04+.03*spK),P.z);
    camera.rotation.y=yaw+(Math.random()-.5)*sh;camera.rotation.x=pitch+(Math.random()-.5)*sh;camera.rotation.z=(Math.random()-.5)*sh;
  }
  const rp=reloading?1-rt/RL:0,tilt=reloading&&!cw.k?reloadPose(rp):(restPose(),0);RS.j=Math.max(0,RS.j-dt*6);
  gun.position.z=-.5+kick*.06+RS.j*.03;gun.position.y=-.24-VMP*.12+VMY+tilt*.06+RS.j*.015+Math.sin(bobT*.5)*.006;gun.position.x=.26-VMP*.1-tilt*.12+Math.cos(bobT*.5)*.01;
  if(BODY){gun.position.x-=.17;gun.position.y-=.03;gun.position.z-=.05}   // bodycam: arma mais ao centro, à frente do peito
  if(gHold>=0){const c=Math.min(1,gHold/GFULL);gun.position.z+=c*.12;gun.position.y+=c*.07;gun.position.x+=c*.05}   // granada: braço recua enquanto carrega
  gun.rotation.x=kick*.1+tilt*.35-swing*.8;gun.rotation.y=tilt*.2;gun.rotation.z=-tilt*.85+swing*.6;
  if(spK>.01){gun.position.y-=.07*spK;gun.position.x-=.04*spK;gun.rotation.y+=.55*spK;gun.rotation.z+=.35*spK;gun.rotation.x-=.25*spK}   // correndo: arma abaixada de lado
  adsK+=((ads&&canAds()?1:0)-adsK)*Math.min(1,dt*11);
  if(adsK>.001){const k=adsK*adsK*(3-2*adsK);   // mira pela alça e massa: topo do ferrolho logo abaixo do centro da tela
    gun.position.x+=(0-gun.position.x)*k;const A=adsPos();gun.position.y+=(A.y+Math.sin(bobT*.5)*.003-gun.position.y)*k;gun.position.z+=(A.z+kick*.05-gun.position.z)*k;
    gun.rotation.x*=1-k*.8;gun.rotation.y*=1-k;gun.rotation.z*=1-k}
  if(VA)viewArms();
  flash.visible=flashT>0;mlight.intensity=flashT>0?3:0;

  updatePickups(dt);
  // ondas
  if(!enemies.length&&!spawning){
    spawning=true;wt=2;
    if(wave>0){hp=Math.min(100,hp+25);resup();money+=300+wave*50;bestW=Math.max(bestW,wave);contW=wave;contS=score;save()}
    banner('Onda '+(wave+1));
  }
  if(spawning){wt-=dt;if(wt<=0&&!SOLDW){spawning=false;wave++;spawnWave()}}

  // inimigos
  flowUpdate(dt);
  for(const e of enemies){
    const dx=P.x-e.x,dz=P.z-e.z,d=Math.hypot(dx,dz)||1;
    e.ph+=dt;
    let vx=0,vz=0;
    const fd=MAPS[MAPI].flow&&!seeLine(e.x,e.z,P.x,P.z)?flowDir(e.x,e.z):null;   // sem ver o jogador: segue as valas/portas
    if(fd){vx=fd[0];vz=fd[1]}
    else{if(d>9){vx=dx/d;vz=dz/d}else if(d<5){vx=-dx/d;vz=-dz/d}
    vx+=-dz/d*Math.sin(e.ph*.8)*.8;vz+=dx/d*Math.sin(e.ph*.8)*.8}
    let slow=1;
    if(e.A&&e.A.crouch){                                             // 3D: às vezes avança agachado (mais devagar)
      e.cr=(e.cr||0)-dt;if(e.cr<0){e.crouch=!e.crouch&&Math.random()<.4;e.cr=2+Math.random()*4}
      e.wc=(e.wc||0)+((e.crouch?1:0)-(e.wc||0))*Math.min(1,dt*4);slow=(1-.45*e.wc)*(1-(e.ws||0));
    }
    e.x+=vx*e.speed*slow*dt;e.z+=vz*e.speed*slow*dt;
    const p={x:e.x,z:e.z};resolve(p,.5);e.x=p.x;e.z=p.z;
    e.g.position.set(e.x,e.mx?0:Math.abs(Math.sin(e.ph*7))*.035,e.z);
    e.g.rotation.y=Math.atan2(dx,dz);
    if(e.mx){                                                        // 3D: mistura correr/parado nas pernas; tronco sempre mirando
      const A=e.A,sp=Math.hypot(vx,vz)*e.speed,k=Math.min(1,sp/1.5),f=(vx*dx+vz*dz)/d;   // f<0: recuando de costas
      e.wb=(e.wb||0)+((f<-.2?1:0)-(e.wb||0))*Math.min(1,dt*6);
      if(A.stop){                                                    // chegou correndo à distância de tiro: freia
        if(e.pd>9&&d<=9&&k>.6)A.stop.reset().play();
        const t=A.stop.isRunning()?A.stop.time:9,D=A.stop.getClip().duration;e.ws=t<D?Math.min(1,t/.15,(D-t)/.3):0;A.stop.setEffectiveWeight(e.ws);
      }
      e.pd=d;
      const c=A.crouch?e.wc:0,b=A.back?e.wb:0,m=k*(1-(e.ws||0));
      A.walk.setEffectiveWeight(m*(1-c)*(1-b));A.idle.setEffectiveWeight((1-k)*(1-(e.ws||0)));   // pesos das pernas somam 1
      if(A.back)A.back.setEffectiveWeight(m*(1-c)*b);if(A.crouch)A.crouch.setEffectiveWeight(m*c);
      A.walk.timeScale=Math.max(.5,sp/3.2);
      if(e.rl>0)e.rl-=dt;else{e.fire-=dt;if(e.fire<=0&&d<36){if(canSee(e)){enemyShoot(e);e.fire=1.4+Math.random()*2;if(--e.ammo<=0){e.rl=ERL;e.ammo=5+Math.floor(Math.random()*4);e.dr=0}}else e.fire=.25}}
      if(e.hitT>0){if(A.hit&&!e.hitA)A.hit.reset().play();e.hitA=1;e.hitT-=dt;if(!A.hit)e.g.rotation.x=-e.hitT*.6}else{e.hitA=0;e.g.rotation.x=0}   // reação ao tiro
      e.mx.update(dt);enemyReload(e);
      continue;
    }
    const sw=Math.sin(e.ph*7),j=e.j;j.hipL.rotation.x=sw*.55;j.hipR.rotation.x=-sw*.55;
    j.kneeL.rotation.x=Math.max(0,Math.sin(e.ph*7+1.6))*.9;j.kneeR.rotation.x=Math.max(0,-Math.sin(e.ph*7+1.6))*.9;j.torso.rotation.y=sw*.06;
    e.fire-=dt;if(e.fire<=0&&d<36){if(canSee(e)){enemyShoot(e);e.fire=1.4+Math.random()*2}else e.fire=.25}
    if(e.hitT>0){e.hitT-=dt;j.torso.rotation.x=-e.hitT*1.6}else j.torso.rotation.x=0;   // tranco ao levar tiro
  }
  // projéteis
  for(let i=shots.length-1;i>=0;i--){
    const s=shots[i],p=s.m.position;s.life-=dt;let dead=s.life<=0;
    const n=Math.ceil(s.v.length()*dt/.25);   // passos de 25 cm: rápida, mas sem atravessar caixa nem jogador
    for(let k=0;k<n&&!dead;k++){p.addScaledVector(s.v,dt/n);
      if(Math.abs(p.x)>HALF||Math.abs(p.z)>HALF||p.y<0||p.y>6){dead=true;break}
      for(const o of boxes){if(p.x>o.minX&&p.x<o.maxX&&p.z>o.minZ&&p.z<o.maxZ&&p.y<o.h){dead=true;sparks(p,s.v.clone().normalize().negate(),4,3);break}}
      if(!dead&&Math.hypot(p.x-P.x,p.z-P.z)<.6&&p.y>P.y&&p.y<P.y+1.9-.65*crK){dead=true;hurt(8)}}
    if(dead){scene.remove(s.m);shots.splice(i,1)}
  }
  // HUD
  $('hpf').style.width=hp+'%';$('hpt').textContent=Math.ceil(hp);
  document.body.classList.toggle('agachado',crouch);
  $('score').textContent=score;$('am').textContent=cw.gr?gren+' / '+GMAX:cw.k?'faca':ammo+' / '+reserve;$('wn').textContent=cw.name;$('mn').textContent='$'+money;
  $('rl').textContent=reloading?'recarregando':(!cw.k&&ammo===0&&reserve===0?'sem munição':'');
  $('rbar').classList.toggle('on',reloading||gHold>=0);$('rbar').firstElementChild.style.width=((gHold>=0?Math.min(1,gHold/GFULL):rp)*100)+'%';   // com a granada: força do arremesso
  const low=!cw.k&&ammo<=Math.ceil(MAG*.3);$('ammo').classList.toggle('low',low);$('cross').classList.toggle('low',low);
  $('cross').style.transform='translate(-50%,-50%) scale('+(1+moveAmt*.4+(P.y>0?.5:0)+kick*.5).toFixed(2)+')';
  $('dmg').style.opacity=dmgA;
  $('arf').style.width=armor+'%';$('art').textContent='Colete '+Math.ceil(armor);$('arb').classList.toggle('hide',armor<=0);
  $('gn').textContent=gren?'Granadas '+gren:'';
}

// ---------- entrada: teclado e mouse ----------
addEventListener('keydown',e=>{
  keys[e.code]=true;if(e.code==='Space')e.preventDefault();
  if((e.code==='ControlLeft'||e.code==='ControlRight'||e.code==='KeyC')&&!e.repeat&&playing&&!paused&&alive){crouch=!crouch;e.preventDefault()}   // alterna: não precisa segurar o Ctrl junto com W
  if(e.code==='KeyB'&&!e.repeat){                                   // B abre a loja de qualquer tela; B de novo fecha e volta ao jogo
    if($('shop').classList.contains('hide'))openShop();else{closeShop();if(playing&&paused)$('play').click()}
    return;
  }
  if(playing&&!paused&&alive){
    if(e.code==='KeyR')doReload();
    if(e.code==='Digit1')equip(1);if(e.code==='Digit2')equip(2);if(e.code==='Digit3')equip(3);if(e.code==='Digit4')equip(4);
    if(e.code==='KeyG')throwGren();
  }
});
addEventListener('keyup',e=>{keys[e.code]=false});
let wheelT=0;   // scroll troca de arma: para baixo a próxima, para cima a anterior; uma troca a cada 150 ms (touchpad manda muitos eventos)
addEventListener('wheel',e=>{if(!playing||paused||!alive||isTouch||!e.deltaY)return;e.preventDefault();const t=performance.now();if(t-wheelT<150)return;wheelT=t;cycle(e.deltaY>0?1:-1)},{passive:false});
let mouseDown=false;
addEventListener('contextmenu',e=>{if(playing)e.preventDefault()});
addEventListener('mousedown',e=>{if(e.button===2&&playing&&!paused&&!isTouch){if(cw.sc)toggleScope();else ads=true}if(e.button===0&&playing&&!paused&&!isTouch){mouseDown=true;if(cw.gr)grenDown();else firing=true}});
addEventListener('mouseup',e=>{if(e.button===2){ads=false;return}mouseDown=false;firing=false;grenUp()});
addEventListener('mousemove',e=>{
  if(!playing||paused||isTouch)return;
  if(document.pointerLockElement||mouseDown){
    const k=.0022*camera.fov/BASEFOV;yaw-=e.movementX*k;pitch=Math.max(-1.45,Math.min(1.45,pitch-e.movementY*k));   // mira mais fina com a luneta
  }
});
let lockedOnce=false;
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement){lockedOnce=true}
  else if(lockedOnce&&playing&&alive&&!paused){lockedOnce=false;paused=true;firing=false;show('Pausado','O jogo está em pausa.','Continuar',['shopb','saveb','menub'])}
});

// celular em retrato estreito: pausa (o aviso "gire o celular" é só CSS, #rot)
addEventListener('resize',()=>{if(isTouch&&innerWidth/innerHeight<.7&&playing&&alive&&!paused){paused=true;firing=false;show('Pausado','Gire o celular para jogar.','Continuar',['shopb','saveb','menub'])}});

// ---------- entrada: toque ----------
const jv={x:0,y:0};let joy=null,look=null;
const stick=$('stick'),knob=stick.firstElementChild;
function endTouch(e){
  for(const t of e.changedTouches){
    if(joy&&t.identifier===joy.id){joy=null;jv.x=jv.y=0;stick.style.display='none';knob.style.transform=''}
    if(look&&t.identifier===look.id)look=null;
  }
}
addEventListener('touchstart',e=>{
  if(!playing||paused)return;
  for(const t of e.changedTouches){
    if(t.target.closest&&t.target.closest('.btn'))continue;
    if(t.clientX<innerWidth*.45&&!joy){
      joy={id:t.identifier,x:t.clientX,y:t.clientY};
      stick.style.left=t.clientX+'px';stick.style.top=t.clientY+'px';stick.style.display='block';
    }else if(t.clientX>=innerWidth*.45&&!look){look={id:t.identifier,x:t.clientX,y:t.clientY}}
  }
},{passive:false});
addEventListener('touchmove',e=>{
  if(playing&&!paused)e.preventDefault();
  for(const t of e.changedTouches){
    if(joy&&t.identifier===joy.id){
      let dx=t.clientX-joy.x,dy=t.clientY-joy.y;const d=Math.hypot(dx,dy),R=50;
      if(d>R){dx=dx/d*R;dy=dy/d*R}
      jv.x=dx/R;jv.y=dy/R;knob.style.transform='translate('+dx+'px,'+dy+'px)';
    }else if(look&&t.identifier===look.id){
      const k=.0055*camera.fov/BASEFOV;yaw-=(t.clientX-look.x)*k;pitch=Math.max(-1.45,Math.min(1.45,pitch-(t.clientY-look.y)*k));
      look.x=t.clientX;look.y=t.clientY;
    }
  }
},{passive:false});
addEventListener('touchend',endTouch);addEventListener('touchcancel',endTouch);
function hold(id,on,off){
  const b=$(id);
  b.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();on();
    const t=e.changedTouches[0];if(t&&playing&&!paused&&!look)look={id:t.identifier,x:t.clientX,y:t.clientY}},{passive:false});   // arrastar o dedo que segura o botão também gira a câmera
  b.addEventListener('touchend',e=>{e.preventDefault();if(off)off()},{passive:false});
  b.addEventListener('touchcancel',()=>{if(off)off()});
}
hold('bF',()=>{if(cw.gr)grenDown();else firing=true},()=>{firing=false;grenUp()});
hold('bJ',()=>{keys.Space=true},()=>{keys.Space=false});
hold('bR',doReload);

// ---------- menu ----------
function show(t,p,b,x){
  $('ot').textContent=t;$('op').textContent=p;$('play').textContent=b;
  ['newb','shopb','saveb','menub'].forEach(i=>$(i).classList.toggle('hide',!(x&&x.includes(i))));
  $('ov').classList.toggle('ttl',t==='Arena FPS');$('ov').classList.remove('hide');
}
$('camb').addEventListener('click',()=>setBody((BMODE+1)%3));   // desligado → trincheira → casa
$('play').addEventListener('click',()=>{
  if(!ac){try{ac=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}
  if(needReset)reset();
  $('ov').classList.add('hide');
  playing=true;paused=false;alive=true;
  if(!isTouch){try{const r=renderer.domElement.requestPointerLock();if(r&&r.catch)r.catch(()=>{})}catch(e){}}
});

// ---------- laço ----------
let last=performance.now();
function loop(t){
  requestAnimationFrame(loop);
  const dt=Math.min(.05,(t-last)/1000);last=t;
  if(playing&&!paused&&alive)update(dt);
  if(!paused){updateFx(dt);updateDust(dt);updateDrops(dt);updateShots(dt);updateXfx(dt);updateBlood(dt)}
  else if(!playing){
    yaw+=dt*.12;pitch=0;camera.position.set(0,3.2,HALF*.73);camera.rotation.set(0,yaw,0);
    gun.position.z=-.5;gun.rotation.set(0,0,0);flash.visible=false;mlight.intensity=0;restPose();
    for(const e of enemies)e.g.position.y=0;
  }
  updateScope();faceBlur();
  if(BODY&&t-bcT>500){bcT=t;const d=new Date(),z=n=>String(n).padStart(2,'0');$('bct').textContent=d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+' '+z(d.getHours())+':'+z(d.getMinutes())+':'+z(d.getSeconds())}
  if(composer){grade.uniforms.time.value=t*.001%100;if(bcPass)bcPass.uniforms.time.value=t*.001%100;composer.render(dt)}else renderer.render(scene,camera);
}
hold('bW',cycle);hold('bS',openShop);hold('bG',throwGren);hold('bZ',zoomBtn);hold('bC',()=>{crouch=!crouch});
$('shopb').onclick=openShop;$('sback').onclick=closeShop;$('bInv').onclick=openShop;
$('saveb').onclick=()=>{contW=Math.max(0,wave-(enemies.length?1:0));contS=score;save();$('op').textContent='Jogo salvo.'};
$('menub').onclick=()=>{save();if(document.pointerLockElement)document.exitPointerLock();playing=false;paused=false;alive=false;needReset=true;lockedOnce=false;showTitle()};
$('newb').onclick=()=>{wipe();wantCont=false;$('play').click()};
loadSave();load(2);setBody(BMODE,true);showTitle();loadSoldier();
if(/[?&]debug/.test(location.search))window.__g={snd:async(code,sec)=>{const o=new OfflineAudioContext(2,44100*(sec||2),44100),k=[ac,MIX];ac=o;MIX=null;try{eval(code)}catch(e){ac=k[0];MIX=k[1];return 'erro: '+e.message}const st=ac.currentTime;ac=k[0];MIX=k[1];const b=await o.startRendering(),d=b.getChannelData(0),r=b.getChannelData(1);let pk=0,sq=0,last=0;for(let i=0;i<d.length;i++){const a=Math.max(Math.abs(d[i]),Math.abs(r[i]));pk=Math.max(pk,a);sq+=d[i]*d[i];if(a>.01)last=i}let l2=0,r2=0;for(let i=0;i<d.length;i++){l2+=d[i]*d[i];r2+=r[i]*r[i]}return {pico:+pk.toFixed(3),rms:+Math.sqrt(sq/d.length).toFixed(4),dura:+(last/44100).toFixed(2),esq_dir:+(Math.sqrt(l2/(r2||1e-9))).toFixed(2)}},tiros:()=>ESHOT,mov:()=>({y:+camera.position.y.toFixed(2),crouch,crK:+crK.toFixed(2),spK:+spK.toFixed(2),x:+P.x.toFixed(2),z:+P.z.toFixed(2)}),mortos:()=>dying.map(d=>[+d.t.toFixed(1),+(d.p.H?d.p.H.c.y:0).toFixed(2)]),ffd:()=>enemies.map(e=>{if(!FF.d)return null;const n=FF.n,H=FF.H;return FF.d[Math.floor(e.z+H)*n+Math.floor(e.x+H)]}),aim:v=>{ads=v;return {fs:cw&&MDL[cw.id]&&MDL[cw.id].tpl?+frontSight().toFixed(3):null,adsK:+adsK.toFixed(2),fov:+camera.fov.toFixed(1),gun:[gun.position.x,gun.position.y,gun.position.z].map(n=>+n.toFixed(3))}},bloodFx,splat,equip,scope:()=>{toggleScope();return {scopeLv,fov:+camera.fov.toFixed(1),on:scoped(),gun:gun.visible}},gr:{down:()=>grenDown(),up:()=>grenUp(),set:n=>{gren=n},st:()=>({cur,gren,gHold:+gHold.toFixed(2),cw:cw.id,voando:grens.length})},ver:async(id,l)=>{for(let i=0;i<80&&(!VA||Object.values(MDL).some(m=>!m.tpl));i++)await new Promise(r=>setTimeout(r,250));GOD=true;if(!playing)$('play').click();enemies.forEach(e=>{e.x=-25;e.z=-25;e.speed=0;e.fire=999});if(id){stash();own[id]=1;st[id]=st[id]||{a:WP[id].mag,r:WP[id].res};eq[WP[id].slot]=id;load(WP[id].slot)}if(l)camera.setViewOffset(innerWidth,innerHeight,l[0]*innerWidth,l[1]*innerHeight,l[2]*innerWidth,l[3]*innerHeight);else camera.clearViewOffset();await new Promise(r=>setTimeout(r,250))},GRIP,lupa:(x,y,w,h)=>{const W=innerWidth,H=innerHeight;if(x==null)camera.clearViewOffset();else camera.setViewOffset(W,H,x*W,y*H,w*W,h*H)},va:()=>VA,viewArms,MDL,eqId:id=>{stash();own[id]=1;st[id]=st[id]||{a:WP[id].mag,r:WP[id].res};eq[WP[id].slot]=id;load(WP[id].slot)},rebuild:()=>{for(const k in MDL)if(MDL[k].tpl){const o=MDL[k].tpl.children[0].children[0];MDL[k].tpl=null;prepWeapon(MDL[k],o)}buildGun(cw)},god:v=>{GOD=v},sold:()=>SOLD,scene,renderer,camera,gun,GM,EM,sl,gl,enemies,hsFx,kill,
  pickups,tp:(x,z)=>{P.x=x;P.z=z},setHp:v=>{hp=v},
  relAt:p=>{if(!reloading){ammo=0;doReload()}RFZ=p},relGo:()=>{RFZ=-1}};   // inspeção pelo console
requestAnimationFrame(loop);
})();
