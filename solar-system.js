(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const AU_KM = 149597870.7;
  const RAD = Math.PI / 180;
  // NASA/JPL Table 1, valid 1800–2050. Elements: a, e, I, L, perihelion,
  // ascending node; followed by their rates per Julian century.
  // https://ssd.jpl.nasa.gov/planets/approx_pos.html
  const planets = [
    ['Mercury','#b9b4ae',4,[.38709927,.20563593,7.00497902,252.25032350,77.45779628,48.33076593],[.00000037,.00001906,-.00594749,149472.67411175,.16047689,-.12534081]],
    ['Venus','#e9bf84',6,[.72333566,.00677672,3.39467605,181.97909950,131.60246718,76.67984255],[.00000390,-.00004107,-.00078890,58517.81538729,.00268329,-.27769418]],
    ['Earth','#55a9ef',7,[1.00000261,.01671123,-.00001531,100.46457166,102.93768193,0],[.00000562,-.00004392,-.01294668,35999.37244981,.32327364,0]],
    ['Mars','#f18b64',6,[1.52371034,.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891],[.00001847,.00007882,-.00813131,19140.30268499,.44441088,-.29257343]],
    ['Jupiter','#d8b498',13,[5.20288700,.04838624,1.30439695,34.39644051,14.72847983,100.47390909],[-.00011607,-.00013253,-.00183714,3034.74612775,.21252668,.20469106]],
    ['Saturn','#e6d399',11,[9.53667594,.05386179,2.48599187,49.95424423,92.59887831,113.66242448],[-.00125060,-.00050991,.00193609,1222.49362201,-.41897216,-.28867794]],
    ['Uranus','#9adce3',9,[19.18916464,.04725744,.77263783,313.23810451,170.95427630,74.01692503],[-.00196176,-.00004397,-.00242939,428.48202785,.40805281,.04240589]],
    ['Neptune','#577bed',9,[30.06992276,.00859048,1.77004347,-55.12002969,44.96476227,131.78422574],[.00026291,.00005105,.00035372,218.45945325,-.32241464,-.00508664]]
  ];
  function elementsAt(planet, time) {
    const T = (time / 86400000 + 2440587.5 - 2451545) / 36525;
    return planet[3].map((value,i) => value + planet[4][i] * T);
  }
  function orbitalPoint(elements, E) {
    const [a,e,inc,,peri,node] = elements;
    const w=(peri-node)*RAD, n=node*RAD, i=inc*RAD;
    const x=a*(Math.cos(E)-e), y=a*Math.sqrt(1-e*e)*Math.sin(E);
    return [
      (Math.cos(w)*Math.cos(n)-Math.sin(w)*Math.sin(n)*Math.cos(i))*x+(-Math.sin(w)*Math.cos(n)-Math.cos(w)*Math.sin(n)*Math.cos(i))*y,
      (Math.cos(w)*Math.sin(n)+Math.sin(w)*Math.cos(n)*Math.cos(i))*x+(-Math.sin(w)*Math.sin(n)+Math.cos(w)*Math.cos(n)*Math.cos(i))*y,
      Math.sin(w)*Math.sin(i)*x+Math.cos(w)*Math.sin(i)*y
    ];
  }
  function positionsAt(time) {
    if (!Number.isFinite(time) || time < Date.UTC(1800,0,1) || time >= Date.UTC(2050,0,1)) throw new RangeError('Model date must be in 1800–2049.');
    return planets.map(planet => {
      const elements=elementsAt(planet,time);
      const M=(((elements[3]-elements[4])%360+540)%360-180)*RAD;
      let E=M;
      for(let j=0;j<20;j++) {
        const correction=(E-elements[1]*Math.sin(E)-M)/(1-elements[1]*Math.cos(E));
        E-=correction;
        if(Math.abs(correction)<1e-12) break;
      }
      return {name:planet[0],color:planet[1],radius:planet[2],position:orbitalPoint(elements,E),elements};
    });
  }
  function distanceAU(a,b=[0,0,0]) {return Math.hypot(...a.map((v,i)=>v-b[i]));}
  // Pure orbital model is available for verification and future integrations.
  window.MarsSolarModel=Object.freeze({positionsAt,distanceAU,AU_KM});
  const canvas=$('solar-canvas'),ctx=canvas.getContext('2d');
  let opened=false,frame=0,width=0,height=0,yaw=-.35,pitch=.65,extent=35;
  let bodies=[],orbits=[],drag=null,previousFocus=null,labelBoxes=[];
  let returning=false,returnAnimations=[];
  let opening=false,openAnimations=[];
  const stars=Array.from({length:650},(_,i)=>{
    const noise=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
    return [noise(i+1),noise(i+901),noise(i+1801)];
  });
  function project(p) {
    const x=p[0]*Math.cos(yaw)-p[1]*Math.sin(yaw), y=p[0]*Math.sin(yaw)+p[1]*Math.cos(yaw);
    const yy=y*Math.sin(pitch)-p[2]*Math.cos(pitch),depth=y*Math.cos(pitch)+p[2]*Math.sin(pitch);
    const desktop=width>720,availableWidth=desktop?width-350:width;
    const availableHeight=desktop?height-165:height*.46;
    const scale=Math.min(availableWidth,availableHeight)/(extent*2);
    return {x:availableWidth/2+x*scale,y:(desktop?100+availableHeight/2:90+availableHeight/2)-yy*scale,depth};
  }
  function schedule(){if(opened&&!frame)frame=requestAnimationFrame(draw);}
  function resize(){width=canvas.clientWidth;height=canvas.clientHeight;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);schedule();}
  function path(points,color,lineWidth=1,dash=[]) {
    ctx.beginPath();points.forEach((p,i)=>{const v=project(p);if(i)ctx.lineTo(v.x,v.y);else ctx.moveTo(v.x,v.y);});
    ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);
  }
  function drawBody(body) {
    const p=project(body.position),r=body.radius;
    if(p.x < -40 || p.x>width+40 || p.y < -40 || p.y>height+40)return;
    if(body.name==='Sun') {
      const glow=ctx.createRadialGradient(p.x,p.y,2,p.x,p.y,60);glow.addColorStop(0,'rgba(255,213,120,.6)');glow.addColorStop(1,'rgba(255,135,30,0)');ctx.fillStyle=glow;ctx.fillRect(p.x-60,p.y-60,120,120);
    }
    if(body.name==='Saturn'){ctx.strokeStyle='#c8b99499';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(p.x,p.y,r*1.9,r*.55,-.35,0,Math.PI*2);ctx.stroke();}
    const shade=ctx.createRadialGradient(p.x-r*.35,p.y-r*.35,0,p.x,p.y,r);
    shade.addColorStop(0,body.name==='Sun'?'#fff5cf':body.color);shade.addColorStop(.65,body.color);shade.addColorStop(1,body.name==='Sun'?'#fb932f':'#14202f');
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=shade;ctx.fill();
    if(body.name==='Mars'||body.name==='Earth'){ctx.strokeStyle=body.color;ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,r+4,0,Math.PI*2);ctx.stroke();}
    ctx.font='12px Consolas, monospace';ctx.textAlign='center';
    const labelWidth=ctx.measureText(body.name).width+10;let labelY=p.y+r+19;
    while(labelBoxes.some(box=>Math.abs(box.x-p.x)<(box.width+labelWidth)/2&&Math.abs(box.y-labelY)<16))labelY+=16;
    labelBoxes.push({x:p.x,y:labelY,width:labelWidth});
    if(labelY>p.y+r+20){ctx.strokeStyle='#78899b77';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(p.x,p.y+r+2);ctx.lineTo(p.x,labelY-11);ctx.stroke();}
    ctx.fillStyle=body.name==='Mars'?'#ffb699':'#dce5f4';ctx.fillText(body.name,p.x,labelY);
  }
  function draw() {
    frame=0;labelBoxes=[];ctx.fillStyle='#02040b';ctx.fillRect(0,0,width,height);
    stars.forEach(([x,y,b])=>{ctx.fillStyle=`rgba(195,217,255,${.15+b*.65})`;ctx.beginPath();ctx.arc(x*width,y*height,b>.96?1.3:.6,0,Math.PI*2);ctx.fill();});
    // Keep off-screen outer planets from appearing underneath the controls
    // or caption when zoomed into the inner solar system.
    ctx.save();ctx.beginPath();ctx.rect(0,80,width>720?width-340:width,width>720?height-180:height*.47);ctx.clip();
    orbits.forEach((points,i)=>path(points,i===3?'#b7674f77':i===2?'#529ec877':'#7086a233'));
    const earth=bodies[2].position,mars=bodies[3].position;
    path([[0,0,0],mars],'#ff8d69',1.5,[5,5]);
    path([[0,0,0],earth],'#ffcf65',1.5,[5,5]);
    path([earth,mars],'#60e4ed',2);
    [...bodies,{name:'Sun',color:'#ffd575',radius:15,position:[0,0,0]}].sort((a,b)=>project(a.position).depth-project(b.position).depth).forEach(drawBody);
    ctx.restore();
  }
  function updateDate() {
    const input=$('solar-date');const time=Date.parse(input.value+'T12:00:00Z');
    try{bodies=positionsAt(time);}catch(error){$('solar-status').textContent=error.message;input.setAttribute('aria-invalid','true');return;}
    input.removeAttribute('aria-invalid');
    orbits=bodies.map(body=>Array.from({length:241},(_,i)=>orbitalPoint(body.elements,i/240*Math.PI*2)));
    const earth=bodies[2].position,mars=bodies[3].position;
    const distances=[['distance-mars-sun',distanceAU(mars)],['distance-mars-earth',distanceAU(mars,earth)],['distance-earth-sun',distanceAU(earth)]];
    distances.forEach(([id,d])=>{$(id).textContent=`${(d*AU_KM/1e6).toFixed(2)} million km · ${d.toFixed(3)} AU`;});
    $('solar-light-time').textContent=`${(distanceAU(mars,earth)*AU_KM/299792.458/60).toFixed(1)} minutes`;
    $('solar-status').textContent=`Model date: ${input.value}, 12:00 UTC. Distances are calculated in 3D.`;
    schedule();
  }
  function today(){const date=new Date().toISOString().slice(0,10);$('solar-date').value=date<'1800-01-01'?'1800-01-01':date>'2049-12-31'?'2049-12-31':date;updateDate();}
  function finishOpening(){
    opening=false;
    openAnimations.forEach(animation=>animation.cancel());openAnimations=[];
    $('solar-view').querySelector('.depart-mars')?.remove();
    $('solar-view').classList.remove('is-opening');
    $('solar-view').removeAttribute('aria-busy');
  }
  function openSolar(){
    if(opened)return;
    previousFocus=document.activeElement;opened=true;
    const view=$('solar-view');view.hidden=false;
    ['control-panel','telemetry-bar','cesiumContainer'].forEach(id=>{$(id).inert=true;});
    $('site-popup').hidden=true;resize();$('close-solar').focus();
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    opening=true;view.classList.add('is-opening');view.setAttribute('aria-busy','true');
    const mars=project(bodies[3].position),radius=Math.min(width,height)*.38;
    const planet=document.createElement('div');planet.className='return-mars depart-mars';
    planet.setAttribute('aria-hidden','true');view.appendChild(planet);
    const duration=1700,options={duration,easing:'cubic-bezier(.25, .65, .3, 1)',fill:'both'};
    openAnimations=[
      $('cesiumContainer').animate([{transform:'scale(1)',opacity:1},{transform:'scale(.65)',opacity:0}],options),
      view.animate([{opacity:0},{opacity:1,offset:.38},{opacity:1}],options),
      canvas.animate([
        {opacity:0,transform:'scale(1.5)',transformOrigin:`${mars.x}px ${mars.y}px`},
        {opacity:1,transform:'scale(1)',transformOrigin:`${mars.x}px ${mars.y}px`}
      ],options),
      planet.animate([
        {left:`${width/2-radius}px`,top:`${height/2-radius}px`,width:`${radius*2}px`,height:`${radius*2}px`,opacity:1},
        {left:`${mars.x-6}px`,top:`${mars.y-6}px`,width:'12px',height:'12px',opacity:0}
      ],options),
      ...[...view.querySelectorAll('.solar-header,.solar-panel,.solar-caption')].map((panel,i)=>panel.animate([
        {opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'translateY(0)'}
      ],{duration:450,delay:1050+i*80,easing:'ease-out',fill:'both'}))
    ];
    Promise.all(openAnimations.map(animation=>animation.finished)).then(()=>{if(opening)finishOpening();}).catch(()=>{});
  }
  function close(){
    finishOpening();
    returning=false;
    returnAnimations.forEach(animation=>animation.cancel());returnAnimations=[];
    $('solar-view').querySelector('.return-mars')?.remove();
    $('solar-view').classList.remove('is-returning');
    $('solar-view').removeAttribute('aria-busy');
    $('close-solar').textContent='← Return to Mars';
    opened=false;$('solar-view').hidden=true;
    $('control-panel').inert=false;$('telemetry-bar').inert=false;$('cesiumContainer').inert=false;
    if(frame)cancelAnimationFrame(frame);frame=0;previousFocus?.focus();
  }
  function returnToMars(){
    if(returning||opening||!opened)return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){close();return;}
    returning=true;drag=null;
    const view=$('solar-view'),mars=project(bodies[3].position);
    const radius=bodies[3].radius,targetRadius=Math.min(width,height)*.38;
    const duration=1800;
    view.classList.add('is-returning');view.setAttribute('aria-busy','true');
    $('close-solar').textContent='Approaching Mars…';
    // A resolution-independent sphere stays sharp throughout the approach.
    const planet=document.createElement('div');planet.className='return-mars';
    planet.setAttribute('aria-hidden','true');view.appendChild(planet);
    // Zoom around the actual projected Mars position, from any orbit angle.
    // The globe's existing camera/location is preserved beneath the dissolve.
    returnAnimations=[
      planet.animate([
        {left:`${mars.x-radius}px`,top:`${mars.y-radius}px`,width:`${radius*2}px`,height:`${radius*2}px`},
        {left:`${width/2-targetRadius}px`,top:`${height/2-targetRadius}px`,width:`${targetRadius*2}px`,height:`${targetRadius*2}px`}
      ],{duration,easing:'cubic-bezier(.55, 0, .15, 1)',fill:'forwards'}),
      canvas.animate([{opacity:1},{opacity:0}],{duration:550,fill:'forwards'}),
      view.animate([{opacity:1},{opacity:1,offset:.55},{opacity:0}],{duration,easing:'ease-in-out',fill:'forwards'}),
      $('cesiumContainer').animate([
        {transform:'scale(.84)',opacity:.35},
        {transform:'scale(.84)',opacity:.35,offset:.45},
        {transform:'scale(1)',opacity:1}
      ],{duration,easing:'cubic-bezier(.2, .65, .3, 1)',fill:'forwards'})
    ];
    Promise.all(returnAnimations.map(animation=>animation.finished)).then(()=>{if(returning)close();}).catch(()=>{});
  }
  $('open-solar').addEventListener('click',openSolar);
  $('close-solar').addEventListener('click',returnToMars);
  $('solar-view').addEventListener('click',e=>{if(returning||opening){e.preventDefault();e.stopImmediatePropagation();}},true);
  $('solar-date').addEventListener('change',updateDate);
  $('solar-today').addEventListener('click',today);
  $('solar-inner').addEventListener('click',()=>{extent=2.05;schedule();});
  $('solar-all').addEventListener('click',()=>{extent=35;schedule();});
  $('solar-reset').addEventListener('click',()=>{yaw=-.35;pitch=.65;extent=35;schedule();});
  canvas.addEventListener('pointerdown',e=>{if(returning||opening)return;drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-drag.x)*.008;pitch=Math.max(.08,Math.min(1.5,pitch+(e.clientY-drag.y)*.006));drag={x:e.clientX,y:e.clientY};schedule();});
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>canvas.addEventListener(type,()=>{drag=null;}));
  canvas.addEventListener('wheel',e=>{e.preventDefault();if(returning||opening)return;extent=Math.max(.5,Math.min(60,extent*Math.exp(e.deltaY*.001)));schedule();},{passive:false});
  window.addEventListener('resize',()=>{if(returning){close();return;}if(opening)finishOpening();if(opened)resize();});
  $('solar-view').addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.stopPropagation();close();}
    if(returning||opening){e.preventDefault();e.stopPropagation();return;}
    if(e.key==='Tab'){
      const items=[...$('solar-view').querySelectorAll('button,input,a[href]')],first=items[0],last=items.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  today();
})();
