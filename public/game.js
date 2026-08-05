const socket=io(),$=id=>document.getElementById(id);
const screens=['lobby','waiting','game'];let playerIndex=null,roomCode='',latestState=null,keys={up:false,down:false,targetY:null},dragging=false;
let audioContext=null,soundEnabled=true,musicTimer=null,musicStep=0;
function ensureAudio(){if(!soundEnabled)return null;if(!audioContext)audioContext=new(window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume();return audioContext}
function tone(frequency,duration=.08,volume=.055,type='sine',delay=0){const ac=ensureAudio();if(!ac)return;const start=ac.currentTime+delay,osc=ac.createOscillator(),gain=ac.createGain();osc.type=type;osc.frequency.setValueAtTime(frequency,start);gain.gain.setValueAtTime(volume,start);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);osc.connect(gain).connect(ac.destination);osc.start(start);osc.stop(start+duration)}
function playSound(kind){if(!soundEnabled)return;if(kind==='paddle')tone(190,.07,.075,'square');if(kind==='wall')tone(360,.045,.035);if(kind==='score'){tone(520,.12,.07,'triangle');tone(760,.16,.055,'triangle',.09)}if(kind==='finish')[392,523,659,784].forEach((n,i)=>tone(n,.3,.06,'triangle',i*.11))}
function startMusic(){if(musicTimer||!soundEnabled)return;const notes=[110,138.59,164.81,207.65,164.81,138.59];musicTimer=setInterval(()=>{if(latestState?.status==='playing')tone(notes[musicStep++%notes.length],.32,.014)},380)}
function stopMusic(){clearInterval(musicTimer);musicTimer=null}
function unlockAudio(){ensureAudio();startMusic()}
addEventListener('pointerdown',unlockAudio,{once:true});
function show(name){screens.forEach(id=>$(id).classList.toggle('hidden',id!==name))}
function enterRoom(r,waiting){if(!r?.ok)return;playerIndex=r.player;roomCode=r.code;latestState=r.state;$('waitingCode').textContent=roomCode;$('gameCode').textContent=roomCode;show(waiting?'waiting':'game');renderState(r.state)}
socket.on('connect',()=>{$('connection').classList.add('online');$('connection').innerHTML='<span></span> 온라인'});
socket.on('disconnect',()=>{$('connection').classList.remove('online');$('connection').innerHTML='<span></span> 재연결 중'});
socket.on('opponentJoined',()=>show('game'));
socket.on('opponentLeft',()=>{resetLocal();$('lobbyError').textContent='상대가 나가서 게임이 종료되었습니다.'});
socket.on('state',state=>{latestState=state;if(state.status!=='waiting')show('game');renderState(state)});
socket.on('sound',playSound);
$('soundToggle').onclick=()=>{soundEnabled=!soundEnabled;$('soundToggle').textContent=soundEnabled?'♫ ON':'♫ OFF';$('soundToggle').classList.toggle('off',!soundEnabled);if(soundEnabled)unlockAudio();else stopMusic()};
$('createBtn').onclick=()=>{unlockAudio();$('lobbyError').textContent='';socket.emit('createRoom',r=>enterRoom(r,true))};
$('joinForm').onsubmit=e=>{e.preventDefault();const code=$('roomInput').value.trim().toUpperCase();if(code.length!==6)return $('lobbyError').textContent='6자리 방 코드를 입력해 주세요.';socket.emit('joinRoom',code,r=>{if(!r?.ok)return $('lobbyError').textContent=r?.error||'참가할 수 없습니다.';enterRoom(r,false)})};
$('roomInput').oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
$('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);const label=$('copyCode').querySelector('small');label.textContent='복사됨!';setTimeout(()=>label.textContent='복사',1200)}catch{}};
function resetLocal(){socket.emit('input',{up:false,down:false,targetY:null});playerIndex=null;roomCode='';latestState=null;keys={up:false,down:false,targetY:null};dragging=false;$('roomInput').value='';show('lobby')}
function leave(){socket.emit('leaveRoom');resetLocal()}
$('cancelBtn').onclick=leave;$('leaveBtn').onclick=leave;$('againBtn').onclick=()=>socket.emit('playAgain');
function sendInput(){socket.emit('input',keys)}function setKey(direction,pressed){if(keys[direction]===pressed)return;keys[direction]=pressed;sendInput()}
addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','KeyW','KeyS'].includes(e.code))e.preventDefault();if(e.code==='ArrowUp'||e.code==='KeyW')setKey('up',true);if(e.code==='ArrowDown'||e.code==='KeyS')setKey('down',true)});
addEventListener('keyup',e=>{if(e.code==='ArrowUp'||e.code==='KeyW')setKey('up',false);if(e.code==='ArrowDown'||e.code==='KeyS')setKey('down',false)});
addEventListener('blur',()=>{keys={up:false,down:false,targetY:null};dragging=false;sendInput()});
function bindTouch(id,direction){const b=$(id);b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture?.(e.pointerId);setKey(direction,true)};for(const event of ['pointerup','pointercancel','pointerleave'])b.addEventListener(event,e=>{e.preventDefault();setKey(direction,false)})}bindTouch('touchUp','up');bindTouch('touchDown','down');
const canvas=$('court'),ctx=canvas.getContext('2d');
function dragTo(event){if(!latestState||playerIndex===null)return;const rect=canvas.getBoundingClientRect();const scaleY=latestState.height/rect.height;const worldY=(event.clientY-rect.top)*scaleY;const touchOffset=event.pointerType==='touch'?Math.min(150,90*scaleY):0;keys.targetY=worldY-latestState.paddleHeight/2-touchOffset;sendInput()}
canvas.addEventListener('pointerdown',event=>{if(!latestState||latestState.status!=='playing')return;event.preventDefault();dragging=true;canvas.setPointerCapture?.(event.pointerId);dragTo(event)});
canvas.addEventListener('pointermove',event=>{if(!dragging)return;event.preventDefault();dragTo(event)});
function endDrag(event){if(!dragging)return;event.preventDefault();dragging=false;keys.targetY=null;sendInput()}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
function drawCourt(s){const w=s.width,h=s.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#060a13';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#42557b61';ctx.lineWidth=2;ctx.setLineDash([12,16]);ctx.beginPath();ctx.moveTo(w/2,0);ctx.lineTo(w/2,h);ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle='#35e7ff19';ctx.lineWidth=1;for(let x=0;x<w;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}for(let y=0;y<h;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}const xs=[s.paddleMargin,w-s.paddleMargin-s.paddleWidth];s.paddles.forEach((y,i)=>{const mine=i===playerIndex;ctx.shadowBlur=mine?24:13;ctx.shadowColor=mine?'#35e7ff':'#8b5cf6';ctx.fillStyle=mine?'#35e7ff':'#8b5cf6';ctx.fillRect(xs[i],y,s.paddleWidth,s.paddleHeight)});ctx.shadowBlur=25;ctx.shadowColor='#fff';ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(s.ball.x,s.ball.y,s.ball.radius,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0}
function renderState(s){drawCourt(s);$('leftScore').textContent=s.scores[0];$('rightScore').textContent=s.scores[1];$('youLabel').style.order=playerIndex===0?'':'3';$('opponentLabel').style.order=playerIndex===0?'':'1';$('scoreboard').querySelector('.score').style.order='2';const counting=s.status==='countdown';$('countdown').classList.toggle('hidden',!counting);if(counting){const value=s.countdown||'GO!';$('countdown').textContent=value;$('gameStatus').textContent=`${value}초 후 시작`}else $('gameStatus').textContent=s.status==='playing'?'경기 진행 중':'경기 종료';const finished=s.status==='finished';$('result').classList.toggle('hidden',!finished);if(finished){const won=s.winner===playerIndex;$('resultTitle').textContent=won?'승리!':'아쉬운 패배';$('resultTitle').style.color=won?'#35e7ff':'#f5f7ff';$('resultScore').textContent=`${s.scores[playerIndex]} : ${s.scores[1-playerIndex]}`}}
drawCourt({width:960,height:540,paddleMargin:38,paddleWidth:18,paddleHeight:112,paddles:[214,214],ball:{x:480,y:270,radius:11}});
