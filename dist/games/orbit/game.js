'use strict';
(() => {
const $=id=>document.getElementById(id), canvas=$('table'), ctx=canvas.getContext('2d');
const W=520,H=840,R=8,FLIPPER_LENGTH=80, keys={left:false,right:false};
let state='idle',ball=null,score=0,best=0,lives=3,multiplier=1,charge=0,charging=false,clock=0,last=0,accumulator=0,saveUntil=0,missionHits=new Set(),particles=[],rings=[],toastTimer,muted=false,audio,flippers=[.38,Math.PI-.38];
try{best=Number(localStorage.getItem('orbit-best'))||0;muted=localStorage.getItem('orbit-muted')==='true';}catch{}
$('best').textContent=String(best).padStart(6,'0');
const bumpers=[{x:207,y:242,r:31},{x:330,y:265,r:31},{x:263,y:359,r:33}];
const targets=[{x:112,y:226},{x:407,y:337},{x:105,y:435},{x:155,y:345},{x:369,y:419},{x:181,y:536},{x:338,y:536}];
const walls=[[[65,655],[44,550]],[[44,550],[31,230]],[[31,230],[46,117]],[[46,117],[105,62]],[[380,62],[444,112]],[[444,112],[461,205]],[[461,205],[461,705]],[[65,655],[155,718]],[[446,655],[368,718]],[[446,655],[452,465]],[[479,800],[492,800]],[[492,800],[492,162]],[[492,162],[475,95]],[[475,95],[426,43]],[[426,43],[342,26]],[[342,26],[120,26]],[[120,26],[62,45]]];
const slings=[[{x:87,y:551},{x:164,y:644},{x:103,y:631}],[{x:424,y:551},{x:347,y:644},{x:408,y:631}]];
function sound(type){if(muted)return;try{audio??=new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const t=audio.currentTime, o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);const tones={bumper:[760,220,.13,'sine'],flipper:[100,45,.065,'triangle'],target:[1280,650,.17,'square'],launch:[120,880,.3,'sawtooth'],drain:[260,65,.5,'triangle'],bonus:[520,1560,.6,'sine'],click:[500,700,.1,'sine']},v=tones[type]||tones.click;o.type=v[3];o.frequency.setValueAtTime(v[0],t);o.frequency.exponentialRampToValueAtTime(v[1],t+v[2]);g.gain.setValueAtTime(type==='flipper'?.08:.045,t);g.gain.exponentialRampToValueAtTime(.001,t+v[2]);o.start(t);o.stop(t+v[2]);}catch{}}
function flash(x,y,color='#67efda',n=12){rings.push({x,y,r:8,life:.5,color});for(let i=0;i<n;i++){let a=Math.random()*Math.PI*2,v=50+Math.random()*180;particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:.4+Math.random()*.4,color});}}
function notify(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),1800);}
function ui(){ $('score').textContent=String(score).padStart(6,'0');$('multi').textContent='×'+multiplier;$('balls').querySelectorAll('i').forEach((e,i)=>e.classList.toggle('lost',i>=lives));$('ballNumber').textContent='BOLA '+Math.min(3,4-lives)+' DE 3';$('status').textContent=state==='paused'?'PAUSADO':state==='playing'?'EM ÓRBITA':state==='ready'?'PRONTO PARA LANÇAR':state==='over'?'FIM DE JOGO':'AGUARDANDO';$('machineState').textContent=state==='playing'?'MISSÃO EM ANDAMENTO':state==='ready'?'AGUARDANDO LANÇAMENTO':state==='paused'?'SISTEMA EM PAUSA':'SISTEMA PRONTO';$('pause').disabled=!['playing','ready','paused'].includes(state);$('save').disabled=$('pause').disabled;$('pause').querySelector('span').textContent=state==='paused'?'CONTINUAR':'PAUSAR';$('missionCount').textContent=missionHits.size+' DE 3 ATIVADOS';$('missionBar').style.width=(missionHits.size/3*100)+'%';document.querySelectorAll('.mission-lights i').forEach((e,i)=>e.classList.toggle('on',missionHits.has(i)));if(score>best){best=score;$('best').textContent=String(best).padStart(6,'0');try{localStorage.setItem('orbit-best',best);}catch{}}}
function points(n){score+=n*multiplier;ui();}
function ready(){state='ready';ball={x:477,y:752,vx:0,vy:0,trail:[]};charge=0;charging=false;ui();}
function start(){clearSave();score=0;lives=3;multiplier=1;missionHits.clear();particles=[];rings=[];$('overlay').hidden=true;keys.left=keys.right=false;sound('click');ready();notify('SEGURE E SOLTE PARA LANÇAR');}
function beginCharge(){if(state==='idle'||state==='over'){start();}if(state==='ready'){charging=true;charge=Math.max(charge,.18);sound('click');}}
function launch(){if(!charging||state!=='ready')return;charging=false;ball.vy=-(1100+charge*380);ball.vx=-12;state='playing';saveUntil=clock+9;charge=0;sound('launch');ui();}
let previousState='playing';
const SAVE_KEY='orbit-saved-game';
function clearSave(){try{localStorage.removeItem(SAVE_KEY);}catch{}}
function saveGame(){
  if(!['playing','ready','paused'].includes(state))return;
  if(state!=='paused')pause();
  flipper('left',false);flipper('right',false);charging=false;charge=0;
  if(previousState==='ready')ball.y=752;
  const snapshot={version:1,state:previousState,score,lives,multiplier,clock,saveUntil,missionHits:[...missionHits],flippers:[...flippers],ball:{x:ball.x,y:ball.y,vx:ball.vx,vy:ball.vy,entered:!!ball.entered}};
  try{
    localStorage.setItem(SAVE_KEY,JSON.stringify(snapshot));
    showOverlay('PARTIDA SALVA','Até a próxima<br>órbita.', 'Pode fechar a página. Volte a este endereço no mesmo navegador para retomar sua partida.','CONTINUAR JOGANDO');
    $('overlay').querySelector('small').textContent='Salvo neste navegador · '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    notify('PARTIDA SALVA');
  }catch{
    showOverlay('NÃO FOI POSSÍVEL SALVAR','Seu jogo<br>está pausado.', 'O navegador não permitiu salvar. Libere o armazenamento deste site e tente novamente antes de fechar.','CONTINUAR JOGANDO');
  }
  $('save').blur();
}
function restoreGame(){
  let data;
  try{
    data=JSON.parse(localStorage.getItem(SAVE_KEY));
    if(!data)return;
    const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
    const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
    if(data.version!==1||!['ready','playing'].includes(data.state)||!integer(data.score,0,Number.MAX_SAFE_INTEGER)||!integer(data.lives,1,3)||!integer(data.multiplier,1,5)||!finite(data.clock,0,1e10)||!finite(data.saveUntil,0,1e10)||!Array.isArray(data.missionHits)||data.missionHits.length>2||new Set(data.missionHits).size!==data.missionHits.length||!data.missionHits.every(i=>integer(i,0,2))||!Array.isArray(data.flippers)||data.flippers.length!==2||!data.flippers.every(a=>finite(a,-Math.PI,Math.PI*2))||!data.ball||!finite(data.ball.x,0,W)||!finite(data.ball.y,0,H+25)||!finite(data.ball.vx,-1500,1500)||!finite(data.ball.vy,-1500,1500)||typeof data.ball.entered!=='boolean')throw new Error('Invalid save');
  }catch{clearSave();return;}
  ({score,lives,multiplier,clock,saveUntil}=data);
  missionHits=new Set(data.missionHits);flippers=[...data.flippers];ball={...data.ball,trail:[]};
  previousState=data.state;state='paused';
  showOverlay('SUA PARTIDA ESTÁ AQUI','Vamos continuar<br>a missão?',score.toLocaleString('pt-BR')+' pontos · '+lives+' bola'+(lives===1?'':'s')+' restante'+(lives===1?'':'s')+'. Retome de onde parou.','RETOMAR PARTIDA');
  $('overlay').querySelector('small').textContent='Salvo neste navegador · Nova partida inicia do zero';
}
function pause(){if(state==='paused'){state=previousState;$('overlay').hidden=true;}else if(state==='playing'||state==='ready'){previousState=state;state='paused';showOverlay('PAUSA NA MISSÃO','Respire.<br>A órbita espera.','Sua partida está aqui, do jeito que você deixou.','CONTINUAR');}ui();}
function showOverlay(label,title,text,button){const overlay=$('overlay');$('toast').classList.remove('show');overlay.hidden=false;overlay.querySelector('.eyebrow').textContent=label;overlay.querySelector('h2').innerHTML=title;overlay.querySelector('p').textContent=text;$('start').innerHTML=button+' <span>↗</span>';overlay.querySelector('small').textContent=muted?'Som desativado':'Luzes e sons do seu fliperama';}
function drain(){sound('drain');keys.left=keys.right=false;if(clock<saveUntil){ready();notify('BOLA SALVA · TENTE OUTRA VEZ');return;}lives--;if(lives>0){ready();notify('NOVA BOLA · VAMOS LÁ');}else{state='over';clearSave();ball=null;showOverlay('MISSÃO CONCLUÍDA','Mais uma<br>órbita?',score.toLocaleString('pt-BR')+' pontos. O espaço ainda tem lugar para um novo recorde.','JOGAR NOVAMENTE');ui();}}
function collideSegment(a,b,radius=0,restitution=.82,kick=0){if(!ball)return false;let dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy,t=Math.max(0,Math.min(1,((ball.x-a.x)*dx+(ball.y-a.y)*dy)/len2)),px=a.x+t*dx,py=a.y+t*dy,nx=ball.x-px,ny=ball.y-py,d=Math.hypot(nx,ny),limit=R+radius;if(d>=limit)return false;if(d<.001){nx=-dy;ny=dx;d=Math.hypot(nx,ny);}nx/=d;ny/=d;ball.x=px+nx*(limit+.1);ball.y=py+ny*(limit+.1);let dot=ball.vx*nx+ball.vy*ny;if(dot<0){ball.vx-=(1+restitution)*dot*nx;ball.vy-=(1+restitution)*dot*ny;}if(kick){ball.vx+=nx*kick;ball.vy+=ny*kick;}return true;}
function physics(dt){clock+=dt;particles=particles.filter(p=>{p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=100*dt;return p.life>0;});rings=rings.filter(p=>{p.life-=dt;p.r+=120*dt;return p.life>0;});for(let i=0;i<2;i++){let goal=i===0?(keys.left?-.48:.38):(keys.right?Math.PI+.48:Math.PI-.38);flippers[i]+=(goal-flippers[i])*Math.min(1,dt*27);}
if(state==='ready'){if(charging)charge=Math.min(1,charge+dt*.85);ball.y=752+charge*22;return;}if(state!=='playing'||!ball)return;
ball.vy+=490*dt;ball.vx*=Math.pow(.999,dt*120);ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;
// The launch lane ends above its divider; the curved top rail feeds the playfield.
if(!ball.entered&&ball.x>461&&ball.y<175&&ball.vy<0){ball.entered=true;ball.x=415;ball.y=166;ball.vx=-280;ball.vy=-180;}

for(const w of walls)collideSegment({x:w[0][0],y:w[0][1]},{x:w[1][0],y:w[1][1]},3);
// One-way gate keeps a launched ball out of the shooter lane.
if(ball.x<461&&ball.y>190&&ball.x>447){ball.x=447;ball.vx=-Math.abs(ball.vx);}
if(ball.x<R+17){ball.x=R+17;ball.vx=Math.abs(ball.vx)*.8;}if(ball.x>W-R-13){ball.x=W-R-13;ball.vx=-Math.abs(ball.vx)*.8;}if(ball.y<R+17){ball.y=R+17;ball.vy=Math.abs(ball.vy)*.8;}
for(let i=0;i<bumpers.length;i++){let b=bumpers[i],dx=ball.x-b.x,dy=ball.y-b.y,d=Math.hypot(dx,dy);if(d<b.r+R){dx/=d||1;dy/=d||1;ball.x=b.x+dx*(b.r+R+.5);ball.y=b.y+dy*(b.r+R+.5);ball.vx=dx*420;ball.vy=dy*420;b.lit=clock+.2;if(!b.hit||clock-b.hit>.12){b.hit=clock;points(250);missionHits.add(i);sound('bumper');flash(b.x,b.y);if(missionHits.size===3){points(5000);multiplier=Math.min(5,multiplier+1);notify('ÓRBITA COMPLETA! +5.000 · ×'+multiplier);sound('bonus');missionHits.clear();}ui();}}}
for(const t of targets){if(collideSegment({x:t.x-12,y:t.y-16},{x:t.x+12,y:t.y+16},5,.9,110)&&(!t.hit||clock-t.hit>.2)){t.hit=clock;points(500);flash(t.x,t.y,'#ef82b6');sound('target');}}
for(let s=0;s<slings.length;s++){const tri=slings[s];for(let i=0;i<3;i++){if(collideSegment(tri[i],tri[(i+1)%3],3,.95,80)){if(!tri.hit||clock-tri.hit>.25){tri.hit=clock;points(100);sound('bumper');flash(ball.x,ball.y,'#efc588',6);}break;}}}
for(let i=0;i<2;i++){let pivot={x:i===0?161:358,y:718},angle=flippers[i],end={x:pivot.x+Math.cos(angle)*FLIPPER_LENGTH,y:pivot.y+Math.sin(angle)*FLIPPER_LENGTH},active=i===0?keys.left:keys.right;if(collideSegment(pivot,end,9,.65)){if(active&&ball.y<Math.max(pivot.y,end.y)+9){let f=Math.min(1,Math.abs(ball.x-pivot.x)/FLIPPER_LENGTH);ball.vy=-560-200*f;ball.vx=(i===0?1:-1)*(100+210*f);if(clock-(ball.flipSound||0)>.1){sound('flipper');ball.flipSound=clock;}}}}
let speed=Math.hypot(ball.vx,ball.vy);if(speed>1350){ball.vx*=1350/speed;ball.vy*=1350/speed;}if(ball.y>H+25){drain();return;}ball.trail.push({x:ball.x,y:ball.y});if(ball.trail.length>13)ball.trail.shift();}
const stars=Array.from({length:95},(_,i)=>({x:24+((i*137.51)%468),y:28+((i*97.31)%730),r:i%6===0?1.4:.65}));
function line(points,color,width=1,glow=0){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowBlur=glow;ctx.shadowColor=color;ctx.stroke();ctx.shadowBlur=0;}
function text(str,x,y,size=12,color='#879bb1',font='DM Sans',align='center'){ctx.textAlign=align;ctx.font=`${size}px "${font}", sans-serif`;ctx.fillStyle=color;ctx.fillText(str,x,y);}
function circle(x,y,r,fill,stroke,width=1){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
function draw(){ctx.clearRect(0,0,W,H);let bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#102238');bg.addColorStop(.6,'#101b30');bg.addColorStop(1,'#101b27');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);for(const s of stars){ctx.globalAlpha=.3+.22*Math.sin(clock+s.x);circle(s.x,s.y,s.r,'#a9cee4');}ctx.globalAlpha=1;
// Subtle field geometry, orbital routes and metal guides.
ctx.save();ctx.translate(260,370);ctx.rotate(-.3);ctx.strokeStyle='#69caba12';ctx.lineWidth=1;for(let r=100;r<340;r+=65){ctx.beginPath();ctx.ellipse(0,0,r,r*.65,0,0,Math.PI*2);ctx.stroke();}ctx.restore();
line([[58,520],[74,179],[129,110],[373,110],[420,172],[436,482]],'#254355',12);line([[58,520],[74,179],[129,110],[373,110],[420,172],[436,482]],'#567f8a',2);line([[81,495],[96,192],[143,135]],'#60dccc',2,7);line([[386,139],[410,198],[423,290]],'#db87ad',2,7);
for(const w of walls){line(w,'#08111d',12);line(w,'#53687e',6);line(w,'#a2bfcc',1.4);}line([[478,735],[478,205]],'#37627b',2,3);
// Upper rollovers.
for(let i=0;i<3;i++){let x=164+i*76;line([[x-24,90],[x-24,158]],'#7b9fba',4);circle(x,118,10,'#173c3d','#6ae6ca');circle(x,118,4,missionHits.has(i)?'#b1ffec':'#45877d');text(['O','R','B'][i],x,161,11,'#73b9bc');}
text('O R B I T',260,470,45,'#5fe5d8','Barlow Condensed');text('S P A C E   E X P E D I T I O N',260,492,9,'#738eaa');text('PINBALL DIVISION  /  01',260,513,7,'#48617d');
// A drawn planet and trajectory mark the top of the playfield.
ctx.save();ctx.translate(264,194);ctx.rotate(-.35);ctx.strokeStyle='#f2bd7833';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,0,65,14,0,0,Math.PI*2);ctx.stroke();circle(0,0,26,'#183343','#b8996f',1.5);line([[-15,0],[13,-6]],'#648485',1);ctx.restore();
for(let i=0;i<bumpers.length;i++){const b=bumpers[i],lit=b.lit>clock,col=lit?'#e4fff4':'#67efda';circle(b.x,b.y+5,b.r+9,'#050b14','#28475a',2);ctx.shadowBlur=lit?34:12;ctx.shadowColor=col;circle(b.x,b.y,b.r+3,'#123d45',col,2);ctx.shadowBlur=0;let g=ctx.createRadialGradient(b.x-7,b.y-9,3,b.x,b.y,b.r);g.addColorStop(0,lit?'#c3ffe4':'#3e8987');g.addColorStop(1,'#183748');circle(b.x,b.y,b.r-5,g,'#7ee3d5',1);circle(b.x,b.y,b.r-13,'#173747','#559f9d',1);text('✦',b.x,b.y+7,23,col);text('250',b.x,b.y+b.r+23,8,'#6babae');}
for(const t of targets){let lit=clock-(t.hit||-2)<.2;ctx.save();ctx.translate(t.x,t.y);ctx.rotate(-.6);ctx.shadowColor='#f080b5';ctx.shadowBlur=lit?25:8;ctx.fillStyle=lit?'#ffd5e8':'#ae517e';ctx.fillRect(-7,-20,14,40);ctx.strokeStyle='#ffc2de';ctx.lineWidth=2;ctx.strokeRect(-7,-20,14,40);ctx.shadowBlur=0;ctx.restore();}
// Mission lamps and lower slingshots.
for(let i=0;i<3;i++){let x=220+i*40,y=560;circle(x,y,10,'#16323a',missionHits.has(i)?'#93ffe0':'#315862',1);if(missionHits.has(i)){ctx.shadowColor='#67efda';ctx.shadowBlur=15;circle(x,y,5,'#67efda');ctx.shadowBlur=0;}text(String(i+1),x,y+26,8,'#4d7b8c');}
for(const tri of slings){let lit=clock-(tri.hit||-2)<.15;ctx.beginPath();tri.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=lit?'#765e39':'#263443';ctx.fill();line([...tri.map(p=>[p.x,p.y]),[tri[0].x,tri[0].y]],lit?'#ffe5ac':'#d3ad73',3,lit?20:4);}
line([[72,580],[79,666],[141,713]],'#547e8b',4);line([[439,580],[432,666],[377,713]],'#547e8b',4);for(const x of [81,438]){circle(x,676,8,'#192735','#91a7b3',2);circle(x,676,3,'#d2dfdf');}
// Flipper bats with a rubber rim, metal core and pivot bolts.
for(let i=0;i<2;i++){const x=i===0?161:358,y=718,a=flippers[i],ex=x+Math.cos(a)*FLIPPER_LENGTH,ey=y+Math.sin(a)*FLIPPER_LENGTH;line([[x,y+4],[ex,ey+4]],'#030a12',24);line([[x,y],[ex,ey]],'#efae8b',22,keys[i===0?'left':'right']?10:0);line([[x,y-1],[ex,ey-1]],'#cad7da',14);line([[x,y-4],[ex,ey-4]],'#f1faf3',3);circle(x,y,7,'#526b7b','#bccbd0',1);circle(x,y,2,'#192535');}
// Shooter spring and launch strength meter.
line([[477,803],[477,783+charge*10]],'#91a4b2',6);let spring=[];for(let i=0;i<14;i++)spring.push([477+(i%2?7:-7),795+i*2]);line(spring,'#7e97a8',1.5);ctx.fillStyle='#1e3445';ctx.fillRect(469,385,15,220);ctx.fillStyle=charging?'#f3cb89':'#315569';ctx.fillRect(472,602-charge*210,9,charge*210);text('L',477,345,9,'#54788f');text('A',477,360,9,'#54788f');text('U',477,375,9,'#54788f');text('N',477,620,9,'#54788f');text('C',477,635,9,'#54788f');text('H',477,650,9,'#54788f');
text('✦',260,640,24,'#3b6a76');text('DEEP SPACE • HIGH SCORE',260,808,8,'#486378');
for(const p of rings){ctx.globalAlpha=p.life*1.7;circle(p.x,p.y,p.r,null,p.color,2);}ctx.globalAlpha=1;for(const p of particles){ctx.globalAlpha=Math.min(1,p.life*2);circle(p.x,p.y,2,p.color);}ctx.globalAlpha=1;
if(ball){for(let i=0;i<ball.trail.length;i++){ctx.globalAlpha=i/ball.trail.length*.23;circle(ball.trail[i].x,ball.trail[i].y,R*i/ball.trail.length,'#b4eaf2');}ctx.globalAlpha=1;circle(ball.x+2,ball.y+5,R+2,'#0008');let g=ctx.createRadialGradient(ball.x-3,ball.y-3,1,ball.x,ball.y,R);g.addColorStop(0,'#fff');g.addColorStop(.35,'#d6edf3');g.addColorStop(.7,'#7b96ad');g.addColorStop(1,'#324352');circle(ball.x,ball.y,R,g,'#afc4cf',.5);}
// Glass edge highlights.
let glass=ctx.createLinearGradient(0,0,W,0);glass.addColorStop(0,'#bbdff10c');glass.addColorStop(.45,'#ffffff00');glass.addColorStop(1,'#9dcaed06');ctx.fillStyle=glass;ctx.fillRect(0,0,W,H);}
function frame(t){let dt=Math.min((t-(last||t))/1000,.035);last=t;if(state!=='paused'){accumulator+=dt;while(accumulator>=1/240){physics(1/240);accumulator-=1/240;}}draw();requestAnimationFrame(frame);}
function flipper(side,on){if(on&&!keys[side]&&['playing','ready'].includes(state))sound('flipper');keys[side]=on;$(side).classList.toggle('active',on);}
function release(){flipper('left',false);flipper('right',false);if(charging)launch();}
function bindHold(id,down,up){const el=$(id);el.addEventListener('pointerdown',e=>{e.preventDefault();el.setPointerCapture(e.pointerId);down();});el.addEventListener('pointerup',e=>{e.preventDefault();up();});el.addEventListener('pointercancel',up);el.addEventListener('lostpointercapture',up);el.addEventListener('contextmenu',e=>e.preventDefault());}
bindHold('left',()=>flipper('left',true),()=>flipper('left',false));bindHold('right',()=>flipper('right',true),()=>flipper('right',false));bindHold('launch',()=>{beginCharge();$('launch').classList.add('active');},()=>{launch();$('launch').classList.remove('active');});
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLButtonElement||$('helpDialog').open)return;if(['ArrowLeft','ArrowRight','Space','KeyA','KeyD','KeyP'].includes(e.code))e.preventDefault();if(e.repeat)return;if(e.code==='ArrowLeft'||e.code==='KeyA')flipper('left',true);if(e.code==='ArrowRight'||e.code==='KeyD')flipper('right',true);if(e.code==='Space')beginCharge();if(e.code==='KeyP')pause();});
window.addEventListener('keyup',e=>{if(e.code==='ArrowLeft'||e.code==='KeyA')flipper('left',false);if(e.code==='ArrowRight'||e.code==='KeyD')flipper('right',false);if(e.code==='Space')launch();});
window.addEventListener('blur',()=>{release();if(['playing','ready'].includes(state))pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden){release();if(['playing','ready'].includes(state))pause();}});
$('start').addEventListener('click',()=>{if(state==='paused')pause();else start();$('start').blur();});$('restart').addEventListener('click',()=>{start();$('restart').blur();});$('pause').addEventListener('click',()=>{pause();$('pause').blur();});
function soundUI(){$('sound').textContent=muted?'♪̸':'♫';$('sound').setAttribute('aria-label',muted?'Ativar som':'Desativar som');$('sound').setAttribute('aria-pressed',String(!muted));}
$('sound').addEventListener('click',()=>{muted=!muted;try{localStorage.setItem('orbit-muted',muted);}catch{}soundUI();sound('click');$('sound').blur();});$('help').addEventListener('click',()=>{if(state==='playing'||state==='ready')pause();$('helpDialog').showModal();});$('closeHelp').addEventListener('click',()=>$('helpDialog').close());$('save').addEventListener('click',saveGame);restoreGame();soundUI();ui();requestAnimationFrame(frame);
})();
