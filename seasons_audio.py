# Soundtrack for src/Seasons.tsx: soft plucked strings + bamboo-flute tones + brush/paper/weather ASMR.
# No beat. Everything shares one reverb so it sits in the same room. 30 fps timeline, 24 s.
import numpy as np, wave
from numpy.fft import rfft, irfft
SR=44100; DUR=24.0; N=int(SR*DUR); rng=np.random.default_rng(11)
dry=np.zeros(N); amb=np.zeros(N)
fr=lambda f:int(f/30*SR)
def put(buf,sig,f0,gain=1.0):
    s=fr(f0); e=min(N,s+len(sig))
    if e>s: buf[s:e]+=gain*sig[:e-s]
def bandnoise(n,lo,hi,seed=None):
    r=np.random.default_rng(seed) if seed is not None else rng
    X=rfft(r.standard_normal(n)); q=np.fft.rfftfreq(n,1/SR); X[(q<lo)|(q>hi)]=0
    y=irfft(X,n); return y/(np.abs(y).max()+1e-9)
def pluck(freq,dur=3.0,bright=0.5):
    # Karplus-Strong, warm guzheng-like string with a soft attack
    n=int(SR*dur); p=int(SR/freq); buf=rng.uniform(-1,1,p)*np.hanning(p); y=np.zeros(n)
    s=0.5*(1+bright)
    for i in range(n):
        y[i]=buf[i%p]; buf[i%p]=0.996*(s*buf[i%p]+(1-s)*buf[(i+1)%p])
    att=np.minimum(1,np.arange(n)/(SR*0.004)); return y*att*np.exp(-np.arange(n)/(SR*1.6))
def flute(freq,dur,amp=0.12):
    t=np.arange(int(SR*dur))/SR; vib=1+0.004*np.sin(2*np.pi*5.2*t)*np.minimum(1,t/0.6)
    ph=2*np.pi*np.cumsum(freq*vib)/SR
    tone=np.sin(ph)+0.25*np.sin(2*ph)+0.08*np.sin(3*ph)
    breath=bandnoise(len(t),freq*0.8,freq*3)*0.18
    env=np.minimum(1,t/0.35)*np.minimum(1,(dur-t)/0.6); return amp*(tone+breath)*np.clip(env,0,1)
def brush(dur=0.6,amp=0.18):
    n=int(SR*dur); y=bandnoise(n,900,7000); t=np.linspace(0,1,n)
    env=np.sin(np.pi*t)**1.5*(0.7+0.3*np.sin(2*np.pi*9*t)); return amp*y*env
def thud(amp=0.5):
    t=np.arange(int(SR*1.2))/SR
    body=np.sin(2*np.pi*(68*t+20*(1-np.exp(-t*30))/30))*np.exp(-t*10)
    wood=bandnoise(len(t),300,1800)*np.exp(-t*60)*0.5
    return amp*(body+wood)
def bell(freq,amp=0.08):
    t=np.arange(int(SR*3))/SR
    return amp*sum(a*np.sin(2*np.pi*freq*m*t)*np.exp(-t*d) for m,a,d in [(1,1,1.2),(2.76,.4,2.2),(5.4,.15,3.5)])

# pentatonic (D major pentatonic) melody, one phrase per season, slow and sparse
D={'D3':146.8,'E3':164.8,'F#3':185.0,'A3':220.0,'B3':246.9,'D4':293.7,'E4':329.6,'F#4':370.0,'A4':440.0,'B4':493.9,'D5':587.3,'E5':659.3}
phr={
 0:[('A4',0),('F#4',14),('D4',30)],
 18:[('D4',0),('E4',18),('F#4',34),('A4',52),('B4',80),('A4',100),('F#4',128),('E4',150)],
 205:[('B3',0),('D4',28),('E4',60),('D4',96),('B3',130)],
 380:[('A4',0),('F#4',24),('E4',48),('D4',80),('B3',110),('A3',140)],
 510:[('F#4',0),('A4',36),('D5',80)],
 668:[('D4',0),('A4',4),('D5',8)],
}
for start,notes in phr.items():
    for name,off in notes:
        put(dry,pluck(D[name],3.0,0.45),start+off,0.22)
        put(dry,pluck(D[name]/2,3.0,0.3),start+off,0.07)  # soft octave below
# flute lines in spring and autumn
put(dry,flute(D['A4'],3.2),54); put(dry,flute(D['B4'],2.6),138)
put(dry,flute(D['E4'],3.0),416); put(dry,flute(D['D4'],3.4),470)
# a low drone that warms the whole piece, constant level for a clean loop
t=np.arange(N)/SR
dry+=0.025*(np.sin(2*np.pi*73.4*t)+0.5*np.sin(2*np.pi*110*t))*(0.85+0.15*np.sin(2*np.pi*t/9))

# brush and paper sounds on text reveals and seal
for f0 in [0,88,214,392,522,632]: put(dry,brush(0.55,0.16),f0)
put(dry,thud(0.6),668)
# spring: light bird chirps (FM sweeps)
for f0 in [58,96,128,163]:
    n=int(SR*0.12); tt=np.arange(n)/SR; fr_=3200+1800*np.sin(np.pi*tt/0.12)
    put(amb,0.05*np.sin(2*np.pi*np.cumsum(fr_)/SR)*np.hanning(n),f0)
    put(amb,0.04*np.sin(2*np.pi*np.cumsum(fr_*1.1)/SR)*np.hanning(n),f0+5)
# monsoon: rain bed + droplets + one distant thunder
s0,s1=fr(208),fr(390); n=s1-s0
rain=bandnoise(n,400,9000)*0.10; env=np.ones(n)
fi=int(SR*1.2); env[:fi]=np.linspace(0,1,fi); env[-fi:]=np.linspace(1,0,fi); amb[s0:s1]+=rain*env
for k in range(160):
    f0=218+rng.random()*152; put(amb,bandnoise(int(SR*0.02),2000,8000)*np.exp(-np.arange(int(SR*0.02))/SR*300)*0.06,f0)
th=bandnoise(int(SR*3),30,180)*np.exp(-np.arange(int(SR*3))/SR*1.3); th*=np.minimum(1,np.arange(len(th))/(SR*0.3)); put(amb,th*0.35,280)
# autumn: wind gusts + leaf rustle
for f0,d in [(380,3.5),(440,3.0),(486,2.5)]:
    n=int(SR*d); g=bandnoise(n,150,900)*np.sin(np.linspace(0,np.pi,n))**2*0.07; put(amb,g,f0)
    put(amb,bandnoise(int(SR*0.8),2500,7000)*np.sin(np.linspace(0,np.pi,int(SR*0.8)))*0.03,f0+30)
# winter: soft wind + sparse bells
n=int(SR*5.5); put(amb,bandnoise(n,200,1200)*np.sin(np.linspace(0,np.pi,n))*0.05,514)
for f0,fq in [(545,D['D5']*2),(585,D['A4']*2)]: put(amb,bell(fq,0.05),f0)

# soft key clicks while code types (season lines and the ending)
def click(a=0.05):
    n=int(SR*0.012); return a*bandnoise(n,1800,6000)*np.exp(-np.arange(n)/SR*500)
for a in [88,214,392,522]:
    for k in range(0,11,1): put(dry,click(0.035),a+18+k)
for i in range(4):
    for k in range(0,7): put(dry,click(0.04),636+i*6+k)
# shared reverb: exponentially decaying noise impulse response (~2.4 s)
irn=int(SR*2.4); ir=rng.standard_normal(irn)*np.exp(-np.arange(irn)/SR*2.6); ir[:int(SR*0.012)]=0; ir/=np.abs(ir).sum()**0.5*8
def conv(x,h):
    L=len(x)+len(h); n2=1<<(L-1).bit_length(); return irfft(rfft(x,n2)*rfft(h,n2),n2)[:len(x)]
mix=dry+amb
wet=conv(mix,ir)
out=0.8*mix+0.55*wet
out/=np.abs(out).max()/0.8
# gentle fade-in/out at the very ends so the loop doesn't click
fe=int(SR*0.08); out[:fe]*=np.linspace(0,1,fe); out[-fe:]*=np.linspace(1,0,fe)
L=out; R=np.roll(out,int(SR*0.011))*0.97+0.03*wet/np.abs(wet).max()
w=wave.open('public/seasons_audio.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((np.clip(np.stack([L,R],1),-1,1)*32767).astype('<i2').tobytes()); w.close(); print('ok')
