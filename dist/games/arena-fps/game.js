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
if(THREE.Sky){
  const sky=new THREE.Sky();sky.scale.setScalar(180);
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
scene.add(new THREE.HemisphereLight(0xcfe0ff,0x7a6248,.2));
const sun=new THREE.DirectionalLight(0xffe9cc,1.7);sun.position.copy(SUN).multiplyScalar(50);scene.add(sun);
sun.castShadow=true;sun.shadow.mapSize.set(isTouch?1024:2048,isTouch?1024:2048);
const shc=sun.shadow.camera;shc.left=-34;shc.right=34;shc.top=34;shc.bottom=-34;shc.near=1;shc.far=110;sun.shadow.bias=-.0004;sun.shadow.normalBias=.03;

// pós-processamento: cena em HDR (half float) → bloom leve → tonemapping ACES, cor, vinheta e grão → FXAA
let composer=null,grade=null,fxaa=null;
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
}

function onResize(){
  const w=innerWidth,h=innerHeight;
  renderer.setSize(w,h);
  camera.aspect=w/h;
  camera.fov=camera.aspect<1?88:75;
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

const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),floorM);
floorM.map.repeat.set(15,15);floorM.normalMap.repeat.set(15,15);
floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
// postes (decoração; de dia ficam apagados)
const poleM=new THREE.MeshStandardMaterial({color:0x2a2d33,metalness:.8,roughness:.45}),lampM=new THREE.MeshStandardMaterial({color:0x9a9890,metalness:.3,roughness:.6});
[[-22,-22],[22,-22],[-22,22],[22,22]].forEach(p=>{
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.08,.1,5,10),poleM);pole.position.set(p[0],2.5,p[1]);pole.castShadow=true;scene.add(pole);
  const lh=new THREE.Mesh(new THREE.BoxGeometry(.5,.12,.3),lampM);lh.position.set(p[0],5.05,p[1]);lh.castShadow=true;scene.add(lh);
});
// poeira suspensa no ar
const dustG=new THREE.BufferGeometry(),DN=isTouch?120:260,dp=new Float32Array(DN*3);
for(let i=0;i<DN;i++){dp[i*3]=(Math.random()*2-1)*29;dp[i*3+1]=Math.random()*5;dp[i*3+2]=(Math.random()*2-1)*29}
dustG.setAttribute('position',new THREE.BufferAttribute(dp,3));
const dust=new THREE.Points(dustG,new THREE.PointsMaterial({color:0xfff2d6,size:.035,transparent:true,opacity:.45,depthWrite:false}));scene.add(dust);
function updateDust(dt){const a=dustG.attributes.position.array;for(let i=0;i<DN;i++){a[i*3]+=Math.sin(i+performance.now()*.0002)*dt*.08;a[i*3+1]+=dt*.03;if(a[i*3+1]>5)a[i*3+1]=0}dustG.attributes.position.needsUpdate=true}

const solids=[],boxes=[];
const HALF=30;
// UV por face proporcional ao tamanho, com número inteiro de repetições (a textura não estica)
function fitUV(geo,w,h,d,t){
  const uv=geo.attributes.uv,dims=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
  for(let f=0;f<6;f++)for(let k=0;k<4;k++){const i=f*4+k;uv.setXY(i,uv.getX(i)*Math.max(1,Math.round(dims[f][0]/t)),uv.getY(i)*Math.max(1,Math.round(dims[f][1]/t)))}
  uv.needsUpdate=true;
}
function addBox(x,z,w,d,h,m,t){
  const geo=new THREE.BoxGeometry(w,h,d);fitUV(geo,w,h,d,t);
  const o=new THREE.Mesh(geo,m);
  o.position.set(x,h/2,z);o.castShadow=o.receiveShadow=true;scene.add(o);solids.push(o);
  return {minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,h};
}
[[0,-HALF-.5,61,1],[0,HALF+.5,61,1],[-HALF-.5,0,1,61],[HALF+.5,0,1,61]].forEach(a=>addBox(a[0],a[1],a[2],a[3],5,wallM,5));
[[-8,-6,4,4,3],[9,-8,3,6,2.5],[0,8,6,2,2],[-14,10,3,3,3],[14,12,4,4,2],[0,-16,8,2,3],[-18,-14,2,6,2.5],[20,0,2,8,3],[-20,0,2,8,2.2]]
 .forEach(a=>boxes.push(a[4]>2.5?addBox(a[0],a[1],a[2],a[3],a[4],conM,3):addBox(a[0],a[1],a[2],a[3],a[4],woodM,1.25)));

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
const flash=new THREE.Group();
const fm=new THREE.MeshBasicMaterial({color:0xffe08a}),fo=new THREE.MeshBasicMaterial({color:0xff7a1a});
flash.add(new THREE.Mesh(new THREE.SphereGeometry(.07,8,8),fm));
const cone=new THREE.Mesh(new THREE.ConeGeometry(.06,.34,7),fo);cone.rotation.x=-Math.PI/2;cone.position.z=-.17;flash.add(cone);
const cone2=new THREE.Mesh(new THREE.ConeGeometry(.04,.5,6),fm);cone2.rotation.x=-Math.PI/2;cone2.position.z=-.25;flash.add(cone2);
flash.position.set(0,.03,-.5);flash.visible=false;gun.add(flash);
const mlight=new THREE.PointLight(0xffa24a,0,9);mlight.position.set(0,.05,-.7);gun.add(mlight);
let mag=new THREE.Object3D();
gun.position.set(.26,-.24,-.5);camera.add(gun);

// ---------- estado ----------
let MAG=15,RL=1.1;
const P={x:0,y:0,z:22,vy:0};
let yaw=0,pitch=0,hp=100,ammo=MAG,reserve=45,score=0,wave=0,wt=0,spawning=false,moveAmt=0,stepT=0;
let armor=0,gren=0,grenCD=0;const GMAX=3,GR=6;
let swing=0,cur=2,money=800,bestW=0,contW=0,contS=0,wantCont=false,cw=null,own={glock:1,knife:1},st={},eq={1:null,2:'glock',3:'knife'};
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
].forEach(a=>{const w=WP[a[0]]={id:a[0],name:a[1],cat:a[2],slot:a[3],price:a[4],dmg:a[5],cd:a[6],mag:a[7],res:a[8],rl:a[9],sp:a[10],auto:a[11],n:a[12],g:a[13],q:a[14]||.4,c:a[15]||0,x2:a[16]||0};w.rc=Math.min(.06,.004+w.dmg*.0004+(w.n>1?.02:0))});
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
  ak:{f:'ak47_counter_strike_2',len:.74,back:.34,gF:.35,fF:.62,flip:1},
  ak12:{f:'ak12',len:.74,back:.34,gF:.35,fF:.62,tint:0x26272a,flip:1},
  bizon:{f:'bizon',len:.62,back:.3,gF:.33,fF:.6,tint:0x2a2b2d,flip:1,drop:/^pp19dc/},
  pmx:{f:'pmx',len:.52,back:.26,gF:.4,fF:.63,flip:1},
  fuzil:{f:'gun',len:.78,back:.34,gF:.33,fF:.6},
  apx:{f:'apx',len:.2,back:.12,gF:.22,pistol:1,flip:1},
  glock:{f:'glock',len:.19,back:.12,gF:.22,pistol:1,rot:[0,Math.PI/2,0],flip:1},   // modelo vem com o comprimento em x
  deagle:{f:'deagle',len:.27,back:.12,gF:.2,pistol:1,flip:1},
  awp:{f:'awp',len:.95,back:.36,gF:.3,fF:.55,flip:1},
  dual:{f:'beretta',len:.2,back:.12,gF:.22,pistol:1,flip:1}
};
// só as armas com modelo 3D (e a faca) ficam no jogo
for(const id in WP)if(!MDL[id]&&!WP[id].k)delete WP[id];
function loadWeapons(){
  if(!THREE.GLTFLoader||location.protocol==='file:')return;
  const L=new THREE.GLTFLoader();
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
}
function makeGun(w,par,proc){
  const md=!proc&&MDL[w.id];
  if(md&&md.tpl){par.add(md.tpl.clone());return {mag:new THREE.Object3D(),muzzle:md.muzzle,grip:md.grip.clone(),gRot:md.pistol?.28:.3,fore:md.fore.clone(),fRot:md.pistol?.28:-1.45}}
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
const clk=(f,v)=>beep(f,.035,'square',v||.05);
const drops=[];
function dropMag(m){                                                 // cópia do pente vazio cai no mundo
  const c=m.clone();m.getWorldPosition(c.position);m.getWorldQuaternion(c.quaternion);m.getWorldScale(c.scale);
  c.traverse(o=>{if(o.isMesh)o.castShadow=true});scene.add(c);
  drops.push({m:c,v:new THREE.Vector3(.5,-.6,.3).applyQuaternion(camera.quaternion),w:new THREE.Vector3(4+Math.random()*3,0,3+Math.random()*3),t:0});
  if(drops.length>10){scene.remove(drops[0].m);drops.shift()}
}
function updateDrops(dt){
  for(let i=drops.length-1;i>=0;i--){
    const d=drops[i],p=d.m.position;d.t+=dt;
    if(!d.rest){
      d.v.y-=14*dt;p.addScaledVector(d.v,dt);d.m.rotation.x+=d.w.x*dt;d.m.rotation.z+=d.w.z*dt;
      const fy=d.fy||.04;
      if(p.y<fy){p.y=fy;if(Math.abs(d.v.y)<1.3){d.rest=true;d.m.rotation.set(d.rx!==undefined?d.rx:Math.PI/2,d.m.rotation.y,0);clk(240,.025)}
        else{d.v.y=-d.v.y*.3;d.v.x*=.5;d.v.z*=.5;d.w.multiplyScalar(.5);clk(330,.035)}}
    }
    if(d.t>12){scene.remove(d.m);drops.splice(i,1)}
  }
}
function restPose(){
  const base=cw&&!cw.k;
  hL.position.copy(HL0);hL.rotation.x=HLR0;hL.visible=!!base;arms();
  mags.forEach(m=>{m.visible=true;m.position.copy(m.userData.rest)});
}
function reloadPose(p){                                              // devolve a inclinação da arma (0..1)
  const base=true,tilt=sm(0,.14,p)*(1-sm(.86,1,p)),MR=mags.length?mags[0].userData.rest:null;
  let hx=HL0.x,hy=HL0.y,hz=HL0.z,show=base;
  if(cw.n>1){                                                        // espingarda: cartucho por cartucho
    const k=sm(.12,.2,p)*(1-sm(.8,.88,p)),n=Math.max(1,Math.min(MAG-RS.a0,6)),c=Math.min(n-.001,Math.max(0,(p-.2)/.6*n)),ph=c%1;
    hy+=k*(-.13+Math.sin(ph*Math.PI)*.09);hz+=k*.12;
    if(k>.5&&ph>.6&&RS.sh<=Math.floor(c)){RS.sh=Math.floor(c)+1;clk(950,.05);RS.j=.4}
    if(RS.empty&&p>.84&&!RS.rk){RS.rk=1;clk(480,.06);setTimeout(()=>clk(780,.05),90);RS.j=1}
  }else if(MR){
    const out=sm(.14,.26,p),down=sm(.22,.4,p)*(1-sm(.4,.58,p)),ins=sm(.58,.68,p),back=sm(.72,.86,p),go=sm(.1,.2,p)*(1-back);
    if(p>=.26&&!RS.dr){RS.dr=1;mags.forEach(dropMag);clk(380,.05)}
    const sx=base?HL0.x:MR.x,sy=base?HL0.y:MR.y-.5,sz=base?HL0.z:MR.z;  // pistola: a mão vem de baixo da tela
    hx=LERP(sx,MR.x,go);hy=LERP(sy,MR.y-.13+ins*.1,go)-down*.38;hz=LERP(sz,MR.z+.01,go);
    show=base||(p>.08&&p<.9);
    const dy=p<.26?-out*.24:-(.24+down*.38)*(1-ins);
    mags.forEach(m=>{m.visible=p<.26||p>=.4;m.position.set(m.userData.rest.x,m.userData.rest.y+dy,m.userData.rest.z)});
    if(p>=.68&&!RS.in){RS.in=1;clk(620,.06);RS.j=.8}
    if(RS.empty&&p>=.76&&!RS.rk){RS.rk=1;clk(470,.06);setTimeout(()=>clk(820,.05),80);RS.j=1}
  }
  hL.position.set(hx,hy,hz);hL.visible=show;
  if(MR&&cw.n===1)hL.rotation.x=LERP(HLR0,.25,sm(.1,.2,p)*(1-sm(.72,.86,p)));   // vira a mão para segurar o pente
  arms();                                                            // o antebraço acompanha a mão
  return tilt;
}
function stash(){const id=eq[cur];if(id&&st[id]){st[id].a=ammo;st[id].r=reserve}}
function load(s){cur=s;const id=eq[s],w=WP[id],q=st[id];cw=w;ammo=q.a;reserve=q.r;MAG=w.mag;RL=w.rl;reloading=false;cool=.3;firing=false;buildGun(w)}
function equip(s){if(!eq[s]){banner('Sem arma primária: abra a loja (B)');return}stash();load(s)}
function cycle(){for(let i=1;i<=3;i++){const s=(cur-1+i)%3+1;if(eq[s]){equip(s);return}}}
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
  cool=cw.cd;swing=1;beep(280,.08,'triangle',.04);
  const ray=new THREE.Raycaster();ray.setFromCamera({x:0,y:0},camera);ray.far=2.6;
  const hit=ray.intersectObjects(enemies.flatMap(e=>e.meshes),false)[0];
  if(hit){const e=hit.object.userData.owner,hs=hit.object.userData.head;
    e.hp-=cw.dmg*(hs?2:1);e.hitT=.12;if(hs)hsFx();const hm=$('hm');hm.classList.toggle('hs',hs);hm.classList.add('on');hmT=.12;
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
  {name:'Granada',price:300,full:()=>gren>=GMAX,info:()=>'Dano até 110 · '+gren+'/'+GMAX+' · tecla G',buy:()=>{gren++},
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
function showTitle(){
  wantCont=contW>0;
  show('Arena FPS','Dinheiro $'+money+(bestW?'  |  Melhor onda '+bestW:''),wantCont?'Continuar (onda '+(contW+1)+')':'Jogar',['newb','shopb']);
}
let alive=false,playing=false,paused=false,needReset=true,reloading=false,rt=0,cool=0,kick=0,flashT=0,hmT=0,dmgA=0,bobT=0;
const enemies=[],shots=[];
const keys={};let firing=false;

// ---------- som ----------
let ac;
function beep(f,d,type,v){
  if(!ac)return;
  try{
    const o=ac.createOscillator(),g=ac.createGain(),t=ac.currentTime;
    o.type=type||'square';o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(Math.max(40,f*.4),t+d);
    g.gain.setValueAtTime(v||.05,t);g.gain.exponentialRampToValueAtTime(.001,t+d);
    o.connect(g);g.connect(ac.destination);o.start();o.stop(t+d);
  }catch(e){}
}

function gunshot(v){
  if(!ac)return;
  try{
    const n=ac.sampleRate*.25|0,b=ac.createBuffer(1,n,ac.sampleRate),d=b.getChannelData(0);
    for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/n,3);
    const s=ac.createBufferSource(),g=ac.createGain(),f=ac.createBiquadFilter();
    f.type='lowpass';f.frequency.value=2600;g.gain.value=v||.35;
    s.buffer=b;s.connect(f);f.connect(g);g.connect(ac.destination);s.start();
  }catch(e){}
  beep(90,.12,'sine',(v||.35)*.25);
}
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
const bloodM=[new THREE.MeshBasicMaterial({color:0x6a0a0a}),new THREE.MeshBasicMaterial({color:0x9a1414})];
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
const PICK_PTS=[[-25,-4],[25,-6],[3,-24],[-12,-22],[12,22],[-26,24],[26,24],[-4,1],[7,3]];
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
function loadSoldier(){
  const done=()=>{SOLDW=false;loadWeapons()};                        // armas só depois do soldado, para não disputar o download
  if(!THREE.GLTFLoader||!THREE.SkeletonUtils||location.protocol==='file:')return done();
  const L=new THREE.GLTFLoader(),fail=e=>{console.warn('soldado 3D indisponível, usando o procedural',e);done()};
  const quat=()=>L.load('assets/soldado.gltf',g=>L.load('assets/animacoes.glb',a=>{try{SOLD=prepSoldier(g.scene,a.animations);console.info('Arena FPS: soldado Quaternius'+(isTouch?' (modo celular)':''));done()}catch(err){fail(err)}},undefined,fail),undefined,fail);
  if(isTouch)return quat();                                         // celular: soldado leve (Quaternius)
  const tat=()=>L.load('assets/tatico.glb',g=>{try{SOLD=prepMixamo(g);VA=makeVArms();console.info('Arena FPS: soldado tático');done()}catch(err){console.warn(err);quat()}},undefined,()=>quat());
  L.load('assets/russo.glb',g=>{try{SOLD=prepMixamo(g,'assets/russo/');VA=makeVArms();console.info('Arena FPS: soldado russo');done()}catch(err){console.warn(err);tat()}},undefined,()=>tat());
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
  return {r,B};
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
  k:{R:{o:[.012,-.01,-.02],f:[0,-.15,-1],t:[-.3,.6,-.7],c:[1.4,1.5,1.1],th:[.3,.4,.3]}}
};
const _ev=new THREE.Euler();
function gripOf(s){
  if(cw.x2&&s==='L'){const r=GRIP.p.R;return{o:[-r.o[0],r.o[1],r.o[2]],f:[-r.f[0],r.f[1],r.f[2]],t:[-r.t[0],r.t[1],r.t[2]],c:r.c,th:r.th,tb:r.tb}}   // duas pistolas: esquerda espelha a direita
  return GRIP[cw.k?'k':cw.cat==='p'?'p':'r'][s];
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
  camera.updateMatrixWorld(true);gun.updateMatrixWorld(true);
  const D=v=>new THREE.Vector3(v[0],v[1],v[2]).normalize().transformDirection(gun.matrixWorld);
  const B=VA.B,hl=s=>B[s+'Hand'].getWorldPosition(new THREE.Vector3()).distanceTo(B[s+'HandMiddle1'].getWorldPosition(new THREE.Vector3()));   // tamanho real da mão
  const wrist=(h,g,s)=>gun.localToWorld(h.position.clone().add(new THREE.Vector3(g.o[0],g.o[1],g.o[2])).addScaledVector(new THREE.Vector3(g.f[0],g.f[1],g.f[2]).normalize(),-hl(s)));
  const gR=gripOf('R');curlHand('Right',gR);
  ikArm('Right',wrist(hR,gR,'Right'),camera.localToWorld(new THREE.Vector3(.6,-.9,.3)),[D(gR.f),D(gR.t)]);
  const gL=hL.visible&&gripOf('L');
  if(gL){curlHand('Left',gL);ikArm('Left',wrist(hL,gL,'Left'),camera.localToWorld(new THREE.Vector3(-.6,-.9,.3)),[D(gL.f),D(gL.t)])}
  else ikArm('Left',camera.localToWorld(new THREE.Vector3(-.3,-.75,.15)),camera.localToWorld(new THREE.Vector3(-.6,-.9,.3)),null); // mão esquerda fora da tela
}
function prepMixamo(gl,tdir){                                        // tdir: pasta das texturas Packed*_Diffuse/Normal (sem ela, cores lisas)
  const sk=o=>Object.assign(o,{skinning:true}),cor=c=>sk(new THREE.MeshStandardMaterial({color:c,roughness:.85,envMapIntensity:.3}));
  const M={Body:cor(0xb98767),Tops:sk(new THREE.MeshStandardMaterial({map:camoT,roughness:.9,envMapIntensity:.3})),Bottoms:sk(new THREE.MeshStandardMaterial({map:camoT,color:0xbfb8a0,roughness:.9,envMapIntensity:.3})),
    Shoes:cor(0x1d1915),Gloves:cor(0x242424),Eyewear:sk(GM.lens.clone())};
  const root=new THREE.Group();gl.scene.scale.setScalar(.01);root.add(gl.scene);   // cm → m
  const TX={},tex=n=>{if(!TX[n]){const t=new THREE.TextureLoader().load(tdir+n+'.png');if(/Diffuse/.test(n))t.encoding=THREE.sRGBEncoding;t.anisotropy=4;TX[n]=t}return TX[n]};
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
    do{x=(Math.random()*2-1)*26;z=(Math.random()*2-1)*26;tries++}
    while(tries<20&&(Math.hypot(x-P.x,z-P.z)<16));
    const s=SOLD?makeSoldier3D():makeSoldier();
    s.g.position.set(x,0,z);s.g.rotation.order='YXZ';scene.add(s.g);
    const e={g:s.g,j:s.j,mx:s.mx,A:s.A,bones:s.bones,muzzle:s.muzzle,helm:s.helm,gun:s.gun,x,z,hp:(3+Math.floor(wave/2))*10,speed:2.2+Math.random()*.8+Math.min(wave*.12,1.6),fire:1+Math.random()*2.5,ph:Math.random()*6,hitT:0,meshes:[]};
    if(s.hit)s.hit.forEach(o=>{o.userData={owner:e,head:o===s.head};e.meshes.push(o)});   // 3D: caixas de acerto invisíveis
    else s.g.traverse(o=>{if(o.isMesh&&!isIn(o,s.gun)){o.userData={owner:e,head:isIn(o,s.head)};e.meshes.push(o)}});
    enemies.push(e);
  }
}
function isIn(o,p){for(let q=o;q;q=q.parent)if(q===p)return true;return false}
const pGeo=new THREE.BoxGeometry(.05,.05,.7),pMat=new THREE.MeshBasicMaterial({color:0xffd98a});
function enemyShoot(e){
  const m=new THREE.Mesh(pGeo,pMat);
  const ry=e.g.rotation.y,cs=Math.cos(ry),sn=Math.sin(ry);let mx=e.x+.14*cs+.98*sn,my=1.39,mz=e.z-.14*sn+.98*cs;
  if(e.muzzle){const w=e.muzzle.getWorldPosition(new THREE.Vector3());mx=w.x;my=w.y;mz=w.z}
  if(e.A&&e.A.fire)e.A.fire.reset().play();                          // coice do tiro (só no soldado tático)   // boca do fuzil do modelo 3D
  m.position.set(mx,my,mz);scene.add(m);
  const tx=P.x+(Math.random()-.5)*1.4,ty=P.y+1.3+(Math.random()-.5)*.6,tz=P.z+(Math.random()-.5)*1.4;
  const v=new THREE.Vector3(tx-mx,ty-my,tz-mz).normalize().multiplyScalar(20+Math.min(wave,8));
  m.lookAt(m.position.clone().add(v));burst(m.position,3,[spMat],4,.05,4,.12,null);
  shots.push({m,v,life:4});gunshot(.12);
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
function clearRag(d){d.bones.forEach(b=>{if(!b.bone)scene.remove(b.o)});if(d.root)scene.remove(d.root)}
const dGeo=new THREE.BoxGeometry(1,1,1),sGeo=new THREE.SphereGeometry(1,10,8);
const dm=[0x4f5d3e,0x2b2e2a,0xc59a7c,0x6b7280,0xff8a3d].map(c=>new THREE.MeshBasicMaterial({color:c}));
const spMat=new THREE.MeshBasicMaterial({color:0xffc04a}),brass=new THREE.MeshBasicMaterial({color:0xc9a227});
const holes=[],holeG=new THREE.CircleGeometry(.06,8),holeM=new THREE.MeshBasicMaterial({color:0x050505,transparent:true,opacity:.8,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
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
  const m=new THREE.Mesh(sGeo,new THREE.MeshBasicMaterial({color:col||0xff9a3a,transparent:true,opacity:op||.8,depthWrite:false}));
  m.position.copy(pos);scene.add(m);fx.push({m,v:new THREE.Vector3(0,rise||0,0),life:life||.35,max:life||.35,g:0,s:sz||1,f:true,op:op||.8});
}
function updateFx(dt){
  for(let i=dying.length-1;i>=0;i--){                                // ragdoll: física por 4 s, depois afunda e some
    const d=dying[i];d.t+=dt;
    if(d.t<4){d.acc+=dt;let n=0;while(d.acc>=RDT&&n++<5){stepRag(d);d.acc-=RDT}}
    else for(const k in d.p)d.p[k].c.y-=dt*.3;
    poseRag(d);
    if(d.t>5.5){clearRag(d);dying.splice(i,1)}
  }
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
    const p=e.g.position.clone();p.y=1.75;burst(p,10,bloodM,4,.06,14,.8,null)}
  dying.push(ragdoll(e,dir,pt,force||3));
  score+=hs?150:100;money+=hs?150:100;beep(160,.3,'sawtooth',.06);
}

// ---------- jogador ----------
function shoot(){
  if(!alive||paused||reloading||cool>0)return;
  if(cw.k){stab();return}
  if(ammo<=0){if(reserve>0)doReload();else{cool=.3;beep(90,.08,'square',.04)}return}
  ammo--;cool=cw.cd;kick=1;flashT=.07;gunshot(cw.q);if(!cw.auto)firing=false;
  flash.scale.setScalar(.8+Math.random()*.7);flash.rotation.z=Math.random()*6.28;
  const mp=new THREE.Vector3(),cd=new THREE.Vector3();flash.getWorldPosition(mp);camera.getWorldDirection(cd);
  burst(mp,7,[spMat],14,.05,3,.22,cd);
  const ep=gun.localToWorld(new THREE.Vector3(.05,.06,-.3));
  burst(ep,1,[brass],3,.05,14,.8,new THREE.Vector3(1,.7,.2).applyQuaternion(camera.quaternion));
  boom(mp,0x8a8a8a,.1,.9,.3,.6);
  const ray=new THREE.Raycaster();
  const sp=cw.sp+moveAmt*.014+(P.y>0?.03:0);
  pitch=Math.min(1.45,pitch+cw.rc*(.6+Math.random()*.8));yaw+=(Math.random()-.5)*.01;
  let hsHit=false;
  for(let pi=0;pi<cw.n;pi++){
  ray.setFromCamera({x:(Math.random()-.5)*sp*2,y:(Math.random()-.5)*sp*2},camera);
  const hit=ray.intersectObjects(solids.concat(enemies.flatMap(e=>e.meshes)),false)[0];
  if(hit)burst(hit.point,5,hit.object.userData.owner?bloodM:[spMat],3.5,.05,9,.3,null);
  if(hit&&!hit.object.userData.owner&&hit.face){
    const nn=hit.face.normal.clone().transformDirection(hit.object.matrixWorld),dc=new THREE.Mesh(holeG,holeM);
    dc.position.copy(hit.point).addScaledVector(nn,.02);dc.lookAt(dc.position.clone().add(nn));scene.add(dc);holes.push(dc);
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
function doReload(){
  if(reloading||ammo===MAG||reserve<=0||!alive)return;
  reloading=true;rt=RL;RS={a0:ammo,empty:ammo===0,dr:0,in:0,rk:0,sh:0,j:0};clk(260,.04);
}
const grens=[],gGeo=new THREE.SphereGeometry(.09,10,8),gMat=new THREE.MeshStandardMaterial({color:0x3d4a2c,roughness:.7});
function throwGren(){
  if(!alive||paused||gren<=0||grenCD>0)return;
  gren--;grenCD=.8;swing=1;beep(320,.08,'triangle',.04);
  const d=new THREE.Vector3();camera.getWorldDirection(d);
  const m=new THREE.Mesh(gGeo,gMat);m.castShadow=true;
  m.position.copy(camera.position).addScaledVector(d,.6);scene.add(m);
  grens.push({m,v:d.multiplyScalar(15).add(new THREE.Vector3(0,3.5,0)),t:1.6});
}
function explode(p){
  boom(p,0xff9a3a,2.4,.5,.9,.6);boom(p,0x555555,1.6,1.2,.5,1.2);
  burst(p,24,[spMat,dm[4],dm[3]],9,.12,14,1,null);gunshot(.7);beep(55,.6,'sawtooth',.12);
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
    g.v.y-=20*dt;p.addScaledVector(g.v,dt);
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
  hp-=n;dmgA=1;yaw+=(Math.random()-.5)*.05;pitch=Math.max(-1.45,Math.min(1.45,pitch+.03));beep(110,.2,'sawtooth',.07);
  if(hp<=0){
    hp=0;armor=0;alive=false;playing=false;needReset=true;bestW=Math.max(bestW,wave);contW=0;contS=0;save();
    if(document.pointerLockElement)document.exitPointerLock();
    show('Fim de jogo','Você chegou à onda '+wave+' com '+score+' pontos.','Jogar de novo',['shopb','menub']);
  }
}
function hsFx(){const b=$('hsb');b.classList.remove('on');void b.offsetWidth;b.classList.add('on');beep(1500,.07,'sine',.05)}
function banner(t){const b=$('banner');b.textContent=t;b.classList.add('on');setTimeout(()=>b.classList.remove('on'),1400)}
function reset(){
  enemies.forEach(e=>scene.remove(e.g));enemies.length=0;
  shots.forEach(s=>scene.remove(s.m));shots.length=0;drops.forEach(d=>scene.remove(d.m));drops.length=0;grens.forEach(g=>scene.remove(g.m));grens.length=0;
  if(!wantCont)startKit();                                          // partida nova (onda 1): volta ao inventário inicial
  hp=100;score=wantCont?contS:0;wave=wantCont?contW:0;wantCont=false;spawning=false;reloading=false;refill();load(eq[1]?1:2);
  pickups.forEach(p=>scene.remove(p.g));pickups.length=0;holes.forEach(h=>scene.remove(h));holes.length=0;dying.forEach(clearRag);dying.length=0;fx.forEach(f=>scene.remove(f.m));fx.length=0;
  P.x=0;P.z=22;P.y=0;P.vy=0;yaw=0;pitch=0;needReset=false;$('wv').textContent='Onda 1';
}

// ---------- atualização ----------
function update(dt){
  // movimento
  let mx=(keys.KeyD?1:0)-(keys.KeyA?1:0)+jv.x,mz=(keys.KeyW?1:0)-(keys.KeyS?1:0)-jv.y;
  const l=Math.hypot(mx,mz);if(l>1){mx/=l;mz/=l}
  moveAmt=Math.min(l,1);
  if(l>.1&&P.y===0){stepT+=dt;if(stepT>.38){stepT=0;beep(70,.06,'triangle',.02)}}
  const sp=cw.k?7.4:6.2,fx=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);
  P.x+=(fx*mz+rx*mx)*sp*dt;P.z+=(fz*mz+rz*mx)*sp*dt;
  resolve(P,.45);
  if(keys.Space&&P.y===0)P.vy=7;
  P.vy-=20*dt;P.y+=P.vy*dt;if(P.y<=0){P.y=0;P.vy=0}
  bobT+=dt*(l>.1&&P.y===0?9:0);
  updateGrens(dt);grenCD-=dt;
  cool-=dt;kick=Math.max(0,kick-dt*8);swing=Math.max(0,swing-dt*5);flashT-=dt;hmT-=dt;dmgA=Math.max(0,dmgA-dt*2.2);
  if(hmT<=0)$('hm').classList.remove('on');
  if(reloading){rt-=dt;if(RFZ>=0)rt=Math.max(.001,RL*(1-RFZ));if(rt<=0){reloading=false;const tk=Math.min(MAG-ammo,reserve);ammo+=tk;reserve-=tk}}
  if(firing)shoot();
  camera.position.set(P.x,P.y+1.7+Math.sin(bobT)*.04,P.z);
  camera.rotation.y=yaw;camera.rotation.x=pitch;
  const rp=reloading?1-rt/RL:0,tilt=reloading&&!cw.k?reloadPose(rp):(restPose(),0);RS.j=Math.max(0,RS.j-dt*6);
  gun.position.z=-.5+kick*.06+RS.j*.03;gun.position.y=-.24+VMY+tilt*.06+RS.j*.015+Math.sin(bobT*.5)*.006;gun.position.x=.26-tilt*.12+Math.cos(bobT*.5)*.01;
  gun.rotation.x=kick*.1+tilt*.35-swing*.8;gun.rotation.y=tilt*.2;gun.rotation.z=-tilt*.85+swing*.6;
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
  for(const e of enemies){
    const dx=P.x-e.x,dz=P.z-e.z,d=Math.hypot(dx,dz)||1;
    e.ph+=dt;
    let vx=0,vz=0;
    if(d>9){vx=dx/d;vz=dz/d}else if(d<5){vx=-dx/d;vz=-dz/d}
    vx+=-dz/d*Math.sin(e.ph*.8)*.8;vz+=dx/d*Math.sin(e.ph*.8)*.8;
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
      e.fire-=dt;if(e.fire<=0&&d<36){enemyShoot(e);e.fire=1.4+Math.random()*2}
      if(e.hitT>0){if(A.hit&&!e.hitA)A.hit.reset().play();e.hitA=1;e.hitT-=dt;if(!A.hit)e.g.rotation.x=-e.hitT*.6}else{e.hitA=0;e.g.rotation.x=0}   // reação ao tiro
      e.mx.update(dt);
      continue;
    }
    const sw=Math.sin(e.ph*7),j=e.j;j.hipL.rotation.x=sw*.55;j.hipR.rotation.x=-sw*.55;
    j.kneeL.rotation.x=Math.max(0,Math.sin(e.ph*7+1.6))*.9;j.kneeR.rotation.x=Math.max(0,-Math.sin(e.ph*7+1.6))*.9;j.torso.rotation.y=sw*.06;
    e.fire-=dt;if(e.fire<=0&&d<36){enemyShoot(e);e.fire=1.4+Math.random()*2}
    if(e.hitT>0){e.hitT-=dt;j.torso.rotation.x=-e.hitT*1.6}else j.torso.rotation.x=0;   // tranco ao levar tiro
  }
  // projéteis
  for(let i=shots.length-1;i>=0;i--){
    const s=shots[i];s.m.position.addScaledVector(s.v,dt);s.life-=dt;
    const p=s.m.position;let dead=s.life<=0||Math.abs(p.x)>HALF||Math.abs(p.z)>HALF||p.y<0||p.y>6;
    if(!dead)for(const o of boxes){if(p.x>o.minX&&p.x<o.maxX&&p.z>o.minZ&&p.z<o.maxZ&&p.y<o.h){dead=true;break}}
    if(!dead&&Math.hypot(p.x-P.x,p.z-P.z)<.6&&p.y>P.y&&p.y<P.y+1.9){dead=true;hurt(8)}
    if(dead){scene.remove(s.m);shots.splice(i,1)}
  }
  // HUD
  $('hpf').style.width=hp+'%';$('hpt').textContent=Math.ceil(hp);
  $('score').textContent=score;$('am').textContent=cw.k?'faca':ammo+' / '+reserve;$('wn').textContent=cw.name;$('mn').textContent='$'+money;
  $('rl').textContent=reloading?'recarregando':(!cw.k&&ammo===0&&reserve===0?'sem munição':'');
  $('rbar').classList.toggle('on',reloading);$('rbar').firstElementChild.style.width=(rp*100)+'%';
  const low=!cw.k&&ammo<=Math.ceil(MAG*.3);$('ammo').classList.toggle('low',low);$('cross').classList.toggle('low',low);
  $('cross').style.transform='translate(-50%,-50%) scale('+(1+moveAmt*.4+(P.y>0?.5:0)+kick*.5).toFixed(2)+')';
  $('dmg').style.opacity=dmgA;
  $('arf').style.width=armor+'%';$('art').textContent='Colete '+Math.ceil(armor);$('arb').classList.toggle('hide',armor<=0);
  $('gn').textContent=gren?'Granadas '+gren:'';
}

// ---------- entrada: teclado e mouse ----------
addEventListener('keydown',e=>{
  keys[e.code]=true;if(e.code==='Space')e.preventDefault();
  if(e.code==='KeyB'&&!e.repeat){                                   // B abre a loja de qualquer tela; B de novo fecha e volta ao jogo
    if($('shop').classList.contains('hide'))openShop();else{closeShop();if(playing&&paused)$('play').click()}
    return;
  }
  if(playing&&!paused&&alive){
    if(e.code==='KeyR')doReload();
    if(e.code==='Digit1')equip(1);if(e.code==='Digit2')equip(2);if(e.code==='Digit3')equip(3);
    if(e.code==='KeyG')throwGren();
  }
});
addEventListener('keyup',e=>{keys[e.code]=false});
let mouseDown=false;
addEventListener('mousedown',e=>{if(e.button===0&&playing&&!paused&&!isTouch){mouseDown=true;firing=true}});
addEventListener('mouseup',()=>{mouseDown=false;firing=false});
addEventListener('mousemove',e=>{
  if(!playing||paused||isTouch)return;
  if(document.pointerLockElement||mouseDown){
    yaw-=e.movementX*.0022;pitch=Math.max(-1.45,Math.min(1.45,pitch-e.movementY*.0022));
  }
});
let lockedOnce=false;
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement){lockedOnce=true}
  else if(lockedOnce&&playing&&alive&&!paused){lockedOnce=false;paused=true;firing=false;show('Pausado','O jogo está em pausa.','Continuar',['shopb','saveb','menub'])}
});

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
      yaw-=(t.clientX-look.x)*.0055;pitch=Math.max(-1.45,Math.min(1.45,pitch-(t.clientY-look.y)*.0055));
      look.x=t.clientX;look.y=t.clientY;
    }
  }
},{passive:false});
addEventListener('touchend',endTouch);addEventListener('touchcancel',endTouch);
function hold(id,on,off){
  const b=$(id);
  b.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();on()},{passive:false});
  b.addEventListener('touchend',e=>{e.preventDefault();if(off)off()},{passive:false});
  b.addEventListener('touchcancel',()=>{if(off)off()});
}
hold('bF',()=>{firing=true},()=>{firing=false});
hold('bJ',()=>{keys.Space=true},()=>{keys.Space=false});
hold('bR',doReload);

// ---------- menu ----------
function show(t,p,b,x){
  $('ot').textContent=t;$('op').textContent=p;$('play').textContent=b;
  ['newb','shopb','saveb','menub'].forEach(i=>$(i).classList.toggle('hide',!(x&&x.includes(i))));
  $('ov').classList.toggle('ttl',t==='Arena FPS');$('ov').classList.remove('hide');
}
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
  if(!paused){updateFx(dt);updateDust(dt);updateDrops(dt)}
  else if(!playing){
    yaw+=dt*.12;pitch=0;camera.position.set(0,3.2,22);camera.rotation.set(0,yaw,0);
    gun.position.z=-.5;gun.rotation.set(0,0,0);flash.visible=false;mlight.intensity=0;restPose();
    for(const e of enemies)e.g.position.y=0;
  }
  if(composer){grade.uniforms.time.value=t*.001%100;composer.render(dt)}else renderer.render(scene,camera);
}
hold('bW',cycle);hold('bS',openShop);hold('bG',throwGren);
$('shopb').onclick=openShop;$('sback').onclick=closeShop;$('bInv').onclick=openShop;
$('saveb').onclick=()=>{contW=Math.max(0,wave-(enemies.length?1:0));contS=score;save();$('op').textContent='Jogo salvo.'};
$('menub').onclick=()=>{save();if(document.pointerLockElement)document.exitPointerLock();playing=false;paused=false;alive=false;needReset=true;lockedOnce=false;showTitle()};
$('newb').onclick=()=>{wipe();wantCont=false;$('play').click()};
loadSave();load(2);showTitle();loadSoldier();
if(/[?&]debug/.test(location.search))window.__g={ver:async(id,l)=>{for(let i=0;i<80&&(!VA||Object.values(MDL).some(m=>!m.tpl));i++)await new Promise(r=>setTimeout(r,250));GOD=true;if(!playing)$('play').click();enemies.forEach(e=>{e.x=-25;e.z=-25;e.speed=0;e.fire=999});if(id){stash();own[id]=1;st[id]=st[id]||{a:WP[id].mag,r:WP[id].res};eq[WP[id].slot]=id;load(WP[id].slot)}if(l)camera.setViewOffset(innerWidth,innerHeight,l[0]*innerWidth,l[1]*innerHeight,l[2]*innerWidth,l[3]*innerHeight);else camera.clearViewOffset();await new Promise(r=>setTimeout(r,250))},GRIP,lupa:(x,y,w,h)=>{const W=innerWidth,H=innerHeight;if(x==null)camera.clearViewOffset();else camera.setViewOffset(W,H,x*W,y*H,w*W,h*H)},va:()=>VA,viewArms,MDL,eqId:id=>{stash();own[id]=1;st[id]=st[id]||{a:WP[id].mag,r:WP[id].res};eq[WP[id].slot]=id;load(WP[id].slot)},rebuild:()=>{for(const k in MDL)if(MDL[k].tpl){const o=MDL[k].tpl.children[0].children[0];MDL[k].tpl=null;prepWeapon(MDL[k],o)}buildGun(cw)},god:v=>{GOD=v},sold:()=>SOLD,scene,renderer,camera,gun,GM,EM,sl,gl,enemies,hsFx,kill,
  pickups,tp:(x,z)=>{P.x=x;P.z=z},setHp:v=>{hp=v},
  relAt:p=>{if(!reloading){ammo=0;doReload()}RFZ=p},relGo:()=>{RFZ=-1}};   // inspeção pelo console
requestAnimationFrame(loop);
})();
