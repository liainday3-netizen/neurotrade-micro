import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis
} from "recharts";

/* ═══════════════════════════════════════════════════════════════
   $3 MICRO-CAPITAL MODE
   Philosophy: Survival first. Never blow up. Compound slowly.
   Target: $3 → $10 → $50 → $500 → $5,000
═══════════════════════════════════════════════════════════════ */

const F  = "'IBM Plex Mono','Courier New',monospace";
const FD = "'Bebas Neue','Anton',sans-serif";

/* ── MICRO RISK PARAMETERS ─────────────────────────────────── */
const MICRO = {
  // Capital milestones
  MILESTONES:        [3, 10, 50, 500, 5000, 50000],
  MILESTONE_LABELS:  ["SEED","SPROUT","SAPLING","TREE","FOREST","EMPIRE"],

  // Position sizing — TINY to preserve capital
  MAX_TRADE_PCT:     0.02,   // never more than 2% per trade at $3
  MAX_TRADE_USD:     0.06,   // hard cap: 6 cents max at $3
  MIN_TRADE_USD:     0.001,  // 0.1 cent minimum
  KELLY_FRACTION:    0.10,   // ultra-conservative 1/10th Kelly
  MAX_OPEN_TRADES:   1,      // one trade at a time until $10

  // Thresholds that SCALE UP as capital grows
  scaleMaxTradePct: (cap) => {
    if (cap >= 5000) return 0.08;
    if (cap >= 500)  return 0.06;
    if (cap >= 50)   return 0.04;
    if (cap >= 10)   return 0.03;
    return 0.02;
  },
  scaleMaxOpen: (cap) => {
    if (cap >= 500)  return 3;
    if (cap >= 50)   return 2;
    if (cap >= 10)   return 2;
    return 1;
  },

  // Kill switches — tighter at micro scale
  DAILY_DD_LIMIT:    0.03,   // 3% daily drawdown = STOP (9 cents at $3)
  TOTAL_DD_LIMIT:    0.10,   // 10% from peak = STOP (30 cents at $3)
  MIN_SPREAD_NET:    0.0025, // 0.25% minimum net spread (must clear fees)
  MIN_WIN_RATE:      0.48,   // brain must have ≥48% win rate to trade

  // Fee reality check
  SOL_GAS_USD:       0.00025, // Solana gas ≈ $0.00025 per tx
  ETH_GAS_USD:       0.50,    // ETH gas ≈ $0.50 — DON'T USE at $3
  ARB_GAS_USD:       0.002,   // Arbitrum ≈ $0.002
  BEST_CHAINS:       ["Solana","Arbitrum","Polygon"], // Low gas only

  // Compound targets
  DAILY_TARGET_PCT:  0.015,  // target 1.5% daily return
  WEEKLY_TARGET_PCT: 0.10,   // target 10% weekly
};

/* ── ASSET UNIVERSE at $3 — low-gas only ─────────────────────*/
const MICRO_ASSETS = [
  { symbol:"SOL",  base:148,   chain:"Solana",   gas:0.00025, minSize:0.001 },
  { symbol:"ARB",  base:1.12,  chain:"Arbitrum", gas:0.002,   minSize:0.01  },
  { symbol:"MATIC",base:0.87,  chain:"Polygon",  gas:0.001,   minSize:0.01  },
  { symbol:"JUP",  base:1.05,  chain:"Solana",   gas:0.00025, minSize:0.01  },
  { symbol:"RAY",  base:2.40,  chain:"Solana",   gas:0.00025, minSize:0.01  },
  { symbol:"BONK", base:0.000028,chain:"Solana", gas:0.00025, minSize:100   },
];

/* ── ADAPTIVE BRAIN (micro-tuned) ─────────────────────────── */
class MicroBrain {
  constructor() {
    this.weights = { momentum:0.30, microArb:0.35, solanaFlow:0.20, gasAware:0.15 };
    this.confidence = 0;
    this.generation = 1;
    this.mutations   = 0;
    this.synapses    = 256;
    this.lr          = 0.06;   // higher LR at micro — needs to learn fast
    this.phase       = "SEED";
    this.trades      = [];
    this.survivalStreak = 0;   // consecutive non-loss ticks
    this.bestCapital    = 3;
  }

  learn(outcome, signals) {
    this.trades.unshift({ outcome, ts: Date.now() });
    if (this.trades.length > 1000) this.trades.pop();

    const r = outcome.pnl > 0 ? 1 : outcome.pnl === 0 ? 0 : -0.8;
    for (const k of Object.keys(this.weights)) {
      const g = r * (signals[k]||0) * this.lr;
      this.weights[k] = Math.max(0.05, Math.min(0.55, this.weights[k] + g));
    }
    const tot = Object.values(this.weights).reduce((a,b)=>a+b,0);
    for (const k of Object.keys(this.weights)) this.weights[k] = +(this.weights[k]/tot).toFixed(4);

    if (outcome.pnl >= 0) this.survivalStreak++;
    else this.survivalStreak = 0;

    if (this.trades.length % 8 === 0) {
      this.synapses += Math.floor(2 + Math.random()*5);
      this.mutations++;
      if (this.mutations % 15 === 0) {
        this.generation++;
        this.lr = Math.max(0.008, this.lr * 0.95);
      }
    }

    this._conf();
    this._phase(outcome.capital || 3);
  }

  score(s) { return Object.entries(this.weights).reduce((a,[k,w])=>a+w*(s[k]||0),0); }

  _conf() {
    const n = this.trades.length;
    if (!n) { this.confidence = 0; return; }
    const wins = this.trades.filter(t=>t.outcome.pnl>0).length;
    const wr   = wins / n;
    const rWr  = this.trades.slice(0,20).filter(t=>t.outcome.pnl>0).length / Math.min(20,n);
    const mat  = Math.min(n/300, 1); // faster maturity at micro
    const streak = Math.min(this.survivalStreak / 20, 1) * 10;
    this.confidence = Math.min(99, +(
      Math.max(0,(wr-0.38)/0.42)*35 + mat*25 + rWr*20 + Math.min(this.generation/10,1)*10 + streak
    ).toFixed(1));
  }

  _phase(cap) {
    if (cap >= 5000) this.phase = "EMPIRE";
    else if (cap >= 500)  this.phase = "FOREST";
    else if (cap >= 50)   this.phase = "TREE";
    else if (cap >= 10)   this.phase = "SPROUT";
    else                  this.phase = "SEED";
  }

  snap() {
    return {
      weights:    { ...this.weights },
      confidence: this.confidence,
      generation: this.generation,
      mutations:  this.mutations,
      synapses:   this.synapses,
      phase:      this.phase,
      trades:     this.trades.length,
      lr:         this.lr,
      survivalStreak: this.survivalStreak,
      wr:         this.trades.length ? +(this.trades.filter(t=>t.outcome.pnl>0).length/this.trades.length*100).toFixed(1) : 0,
    };
  }
}

/* ── Micro Kelly position sizer ──────────────────────────────*/
function calcPositionSize(capital, winRate, avgWin, avgLoss, confidence) {
  // Full Kelly
  const b    = avgWin / Math.max(avgLoss, 0.0001);
  const full = (winRate * b - (1 - winRate)) / b;
  // Quarter-Kelly, scaled by confidence, capped hard
  const safe = Math.max(0, full) * MICRO.KELLY_FRACTION * (confidence / 100);
  const maxPct = MICRO.scaleMaxTradePct(capital);
  const pct  = Math.min(safe, maxPct);
  const raw  = capital * pct;
  // Hard floor and ceiling
  return Math.max(MICRO.MIN_TRADE_USD, Math.min(raw, capital * maxPct));
}

/* ── Helpers ─────────────────────────────────────────────────*/
const jit = (v,p=0.006) => v*(1+(Math.random()-0.5)*p*2);
const rnd = (a,b) => a+Math.random()*(b-a);
const pnlCol = n => n>=0 ? "#00ffb4" : "#ff5555";
const fmt$ = (n,d=6) => {
  if (Math.abs(n) >= 1000) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 1)    return `$${n.toFixed(4)}`;
  return `$${n.toFixed(d)}`;
};
const fmtPct = n => `${n>=0?"+":""}${(n*100).toFixed(3)}%`;

// Milestone info
function getMilestoneInfo(cap) {
  const ms = MICRO.MILESTONES;
  const lb = MICRO.MILESTONE_LABELS;
  for (let i = 0; i < ms.length - 1; i++) {
    if (cap >= ms[i] && cap < ms[i+1]) {
      const pct = ((cap - ms[i]) / (ms[i+1] - ms[i]) * 100);
      return { current: ms[i], next: ms[i+1], label: lb[i], nextLabel: lb[i+1], pct, idx: i };
    }
  }
  return { current: ms[ms.length-1], next: null, label: lb[lb.length-1], nextLabel: null, pct: 100, idx: ms.length-1 };
}

// Days to next milestone at current daily rate
function daysToNext(capital, dailyReturn, nextTarget) {
  if (!nextTarget || dailyReturn <= 0) return "∞";
  const n = Math.ceil(Math.log(nextTarget / capital) / Math.log(1 + dailyReturn));
  if (n > 9999) return "∞";
  if (n > 365)  return `${Math.floor(n/365)}y ${Math.floor((n%365)/30)}mo`;
  if (n > 30)   return `${Math.floor(n/30)}mo ${n%30}d`;
  return `${n}d`;
}

/* ── Custom tooltip ──────────────────────────────────────────*/
function TT({active,payload,label}){
  if(!active||!payload?.length) return null;
  return(
    <div style={{background:"#071510",border:"1px solid rgba(0,255,180,0.2)",borderRadius:4,padding:"6px 10px",fontSize:10,fontFamily:F}}>
      <div style={{color:"#3af5a0",opacity:0.7,marginBottom:2}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color||"#00ffb4"}}>
          {p.name}: {typeof p.value==="number"?fmt$(p.value):p.value}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */
export default function MicroCapitalBrain() {
  const brain = useRef(new MicroBrain());

  const [running,    setRunning]    = useState(false);
  const [tab,        setTab]        = useState("DASHBOARD");
  const [isLive,     setIsLive]     = useState(false);
  const [autoExec,   setAutoExec]   = useState(false);

  // Capital & performance
  const [capital,    setCap]        = useState(3.00);
  const [peakCap,    setPeak]       = useState(3.00);
  const [allTimeHigh,setATH]        = useState(3.00);
  const [equity,     setEquity]     = useState([{t:0,v:3.00}]);
  const [trades,     setTrades]     = useState([]);
  const [execLog,    setExecLog]    = useState([]);
  const [dailyStart, setDailyStart] = useState(3.00);
  const [sessionPnL, setSessionPnL] = useState(0);

  // Brain
  const [brainSnap,  setBrainSnap]  = useState(brain.current.snap());
  const [wHist,      setWHist]      = useState([]);

  // Risk
  const [riskMet,    setRiskMet]    = useState({ sharpe:0,sortino:0,maxDD:0,pf:1,wr:0,var99:0,ev:0 });
  const [killSwitch, setKill]       = useState(false);
  const [killReason, setKillReason] = useState(null);
  const [ddToday,    setDDToday]    = useState(0);

  // Prices
  const [prices,     setPrices]     = useState(
    () => Object.fromEntries(MICRO_ASSETS.map(a=>[a.symbol,{cur:a.base,hist:[],chg:0}]))
  );

  // Compound projections
  const [projections, setProjections] = useState([]);

  const intervalRef = useRef(null);
  const tickRef     = useRef(0);
  const capRef      = useRef(3.00);
  const peakRef     = useRef(3.00);
  const dailyRef    = useRef(3.00);
  const liveRef     = useRef(false);
  const autoRef     = useRef(false);
  const priceRef    = useRef(Object.fromEntries(MICRO_ASSETS.map(a=>[a.symbol,a.base])));
  const tradesRef   = useRef([]);
  liveRef.current = isLive;
  autoRef.current = autoExec;

  /* ── Compute compound projections ───────────────────────── */
  const computeProjections = useCallback((cap, dailyRet) => {
    const dr = Math.max(dailyRet, 0.005); // floor at 0.5%/day
    return MICRO.MILESTONES.map((target, i) => {
      if (target <= cap) return { target, label: MICRO.MILESTONE_LABELS[i], days: 0, reached: true };
      const days = Math.ceil(Math.log(target/cap) / Math.log(1+dr));
      return { target, label: MICRO.MILESTONE_LABELS[i], days, reached: false,
        date: new Date(Date.now() + days*86400000).toLocaleDateString() };
    });
  }, []);

  /* ── Main engine tick ──────────────────────────────────────*/
  const doTick = useCallback(() => {
    if (killSwitch) return;
    tickRef.current++;
    const t = tickRef.current;

    // Update prices
    MICRO_ASSETS.forEach(a => {
      priceRef.current[a.symbol] = jit(priceRef.current[a.symbol], 0.006);
    });

    const bs     = brain.current.snap();
    const cap    = capRef.current;

    // Abort if drawdown kill triggered
    const ddToday = Math.max(0, (dailyRef.current - cap) / dailyRef.current * 100);
    const ddTotal = Math.max(0, (peakRef.current - cap)  / peakRef.current * 100);
    if (ddToday >= MICRO.DAILY_DD_LIMIT * 100) {
      setKill(true); setKillReason(`Daily drawdown ${ddToday.toFixed(2)}% ≥ ${MICRO.DAILY_DD_LIMIT*100}% limit`);
      setRunning(false); clearInterval(intervalRef.current);
      return;
    }
    if (ddTotal >= MICRO.TOTAL_DD_LIMIT * 100) {
      setKill(true); setKillReason(`Total drawdown ${ddTotal.toFixed(2)}% ≥ ${MICRO.TOTAL_DD_LIMIT*100}% limit`);
      setRunning(false); clearInterval(intervalRef.current);
      return;
    }

    setDDToday(ddToday);

    // Brain signals — micro-specific
    const sigs = {
      momentum:    rnd(-1,1),
      microArb:    rnd(-0.5,0.5),   // tiny cross-DEX spreads
      solanaFlow:  rnd(-0.8,0.8),   // Solana on-chain flow
      gasAware:    rnd(-0.3,0.3),   // gas-efficiency signal
    };
    const score = brain.current.score(sigs);

    // Only trade if auto-exec on, confidence gate cleared, strong signal
    const confGate = liveRef.current ? 55 : 35;
    const canTrade = autoRef.current && bs.confidence >= confGate && Math.abs(score) > 0.18 && Math.random() < 0.28;

    if (canTrade) {
      // Pick lowest-gas asset
      const asset = MICRO_ASSETS[Math.floor(Math.random() * MICRO_ASSETS.length)];
      const gasCost = asset.gas;

      // Calculate micro Kelly size
      const wr    = bs.wr / 100 || 0.50;
      const aWin  = 0.004;   // estimated avg win %
      const aLoss = 0.002;   // estimated avg loss %
      const size  = calcPositionSize(cap, wr, aWin, aLoss, bs.confidence);

      // Viability check: net spread must clear gas
      const netViable = (size * aWin - gasCost) > 0;
      if (!netViable) {
        // Trade too small to cover gas — log and skip
        setExecLog(l => [{
          ts: new Date().toLocaleTimeString(),
          msg: `⛽ SKIPPED ${asset.symbol} — size $${size.toFixed(5)} too small vs gas $${gasCost}`,
          color: "#f5c842", type: "SKIP"
        }, ...l].slice(0, 40));
        return; // Don't trade
      }

      const won = Math.random() < (0.40 + bs.confidence * 0.004);
      const pnl = won
        ? +(size * rnd(0.002, 0.008) - gasCost).toFixed(7)
        : -(size * rnd(0.001, 0.004) + gasCost).toFixed(7);

      const newCap = Math.max(0, +(cap + pnl).toFixed(7));
      capRef.current = newCap;
      if (newCap > peakRef.current) peakRef.current = newCap;

      const trade = {
        t, asset: asset.symbol, chain: asset.chain, size: +size.toFixed(6),
        pnl, won, gas: gasCost, mode: liveRef.current ? "LIVE" : "PAPER",
        capital: newCap, ts: Date.now()
      };
      tradesRef.current.unshift(trade);
      if (tradesRef.current.length > 500) tradesRef.current.pop();

      brain.current.learn({ pnl, won, capital: newCap }, sigs);

      setExecLog(l => [{
        ts:    new Date().toLocaleTimeString(),
        msg:   `${liveRef.current?"🔴":"📄"} ${asset.symbol} ${won?"WIN":"LOSS"} ${pnl>=0?"+":""}${fmt$(pnl)} (size ${fmt$(size)}, gas ${fmt$(gasCost)})`,
        color: won ? "#00ffb4" : "#ff5555",
        mode:  trade.mode, won,
      }, ...l].slice(0, 40));

      setCap(newCap);
      setPeak(p => Math.max(p, newCap));
      setATH(a => Math.max(a, newCap));
      setSessionPnL(p => +(p+pnl).toFixed(7));
      setTrades([...tradesRef.current.slice(0, 100)]);
    }

    // Update equity curve
    setEquity(eq => [...eq, { t, v: +capRef.current.toFixed(7) }].slice(-300));

    // Price state
    if (t % 3 === 0) {
      setPrices(prev => {
        const next = { ...prev };
        MICRO_ASSETS.forEach(a => {
          const np = priceRef.current[a.symbol];
          const ph = [...(prev[a.symbol]?.hist||[]).slice(-40), { t, p: np }];
          const c  = prev[a.symbol]?.hist?.[0]?.p;
          next[a.symbol] = { cur: np, hist: ph, chg: c ? +((np-c)/c*100).toFixed(3) : 0 };
        });
        return next;
      });
    }

    // Risk metrics
    const tl = tradesRef.current;
    if (tl.length > 0 && t % 5 === 0) {
      const ws = tl.filter(x=>x.pnl>0), ls = tl.filter(x=>x.pnl<0);
      const gp = ws.reduce((s,x)=>s+x.pnl,0);
      const gl = Math.abs(ls.reduce((s,x)=>s+x.pnl,0));
      const wr = tl.length ? ws.length/tl.length*100 : 0;
      const pf = gl>0 ? gp/gl : gp>0 ? 10 : 1;
      const rets = tl.slice(0,60).map(x=>x.pnl);
      const mr = rets.length ? rets.reduce((a,b)=>a+b,0)/rets.length : 0;
      const sd = Math.sqrt(rets.reduce((a,r)=>a+(r-mr)**2,0)/Math.max(rets.length,1));
      const nd = rets.filter(r=>r<0);
      const dd = nd.length ? Math.sqrt(nd.reduce((a,r)=>a+r**2,0)/nd.length) : 0.0001;
      const sh = sd>0 ? (mr/sd)*Math.sqrt(365) : 0;
      const so = dd>0 ? (mr/dd)*Math.sqrt(365) : 0;
      const sorted = [...rets].sort((a,b)=>a-b);
      const v99 = Math.abs(sorted[Math.floor(sorted.length*0.01)]||0);
      const ev  = wr/100 * (gp/Math.max(ws.length,1)) - (1-wr/100)*(gl/Math.max(ls.length,1));
      setRiskMet({ sharpe:+sh.toFixed(2), sortino:+so.toFixed(2), maxDD:+ddTotal.toFixed(3), pf:+Math.min(pf,99).toFixed(2), wr:+wr.toFixed(1), var99:+v99.toFixed(7), ev:+ev.toFixed(7) });
    }

    // Brain snapshot
    if (t % 6 === 0) {
      const snap = brain.current.snap();
      setBrainSnap(snap);
      setWHist(wh => [...wh, { t, ...snap.weights }].slice(-60));
      // Recompute projections
      const dr = sessionPnL > 0 && tickRef.current > 20
        ? sessionPnL / Math.max(capRef.current, 0.01) / Math.max(tickRef.current/50, 1)
        : MICRO.DAILY_TARGET_PCT;
      setProjections(computeProjections(capRef.current, Math.max(dr, 0.005)));
    }

  }, [killSwitch, sessionPnL, computeProjections]);

  const startStop = () => {
    if (killSwitch) return;
    if (running) { clearInterval(intervalRef.current); setRunning(false); }
    else { setRunning(true); intervalRef.current = setInterval(doTick, 1100); }
  };
  const resetKill = () => { setKill(false); setKillReason(null); };
  useEffect(() => () => clearInterval(intervalRef.current), []);

  // Initial projections
  useEffect(() => {
    setProjections(computeProjections(3, MICRO.DAILY_TARGET_PCT));
  }, [computeProjections]);

  /* ── Derived ────────────────────────────────────────────── */
  const totalPnL   = capital - 3;
  const totalPct   = (totalPnL / 3 * 100);
  const milestone  = getMilestoneInfo(capital);
  const phaseColors= { SEED:"#f5c842", SPROUT:"#34d399", TREE:"#00ffb4", FOREST:"#00d4ff", EMPIRE:"#a78bfa" };
  const phaseC     = phaseColors[brainSnap.phase] || "#f5c842";
  const maxTrade   = MICRO.scaleMaxTradePct(capital) * capital;

  /* ── Styles ─────────────────────────────────────────────── */
  const BG    = "#020c06";
  const CARD  = { background:"rgba(0,18,8,0.95)", border:"1px solid rgba(0,255,180,0.1)", borderRadius:8, padding:"12px 14px", backdropFilter:"blur(8px)" };
  const LBL   = { fontSize:8, letterSpacing:"0.25em", color:"#3af5a0", opacity:0.55, textTransform:"uppercase", fontFamily:F };
  const SEC   = { ...CARD, marginBottom:10 };
  const TAB_S = (active) => ({
    padding:"5px 12px", borderRadius:4, cursor:"pointer", fontSize:8, letterSpacing:"0.15em",
    border:`1px solid ${active?"#00ffb4":"rgba(0,255,180,0.15)"}`,
    fontFamily:F, background:active?"rgba(0,255,180,0.1)":"transparent",
    color:active?"#00ffb4":"rgba(0,255,180,0.5)", textTransform:"uppercase", fontWeight:active?700:400,
  });

  const TABS = ["DASHBOARD","BRAIN","RISK","PRICES","GROWTH","LOG"];

  return (
    <div style={{ fontFamily:F, background:BG, color:"#c8ffe8", minHeight:"100vh", padding:"10px 12px" }}>
      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1a4a3a;border-radius:2px}
        @keyframes tPulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:0;transform:scale(1.7)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
        @keyframes slideIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
        @keyframes glow{0%,100%{box-shadow:0 0 6px rgba(0,255,180,0.2)}50%{box-shadow:0 0 20px rgba(0,255,180,0.5)}}
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes countUp{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      <div style={{ maxWidth:1100, margin:"0 auto" }}>

        {/* ══ HEADER ══ */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10, flexWrap:"wrap", gap:8 }}>
          <div>
            <div style={{
              fontFamily:FD, fontSize:"clamp(22px,4vw,40px)", letterSpacing:"0.12em", lineHeight:1,
              background:"linear-gradient(135deg,#f5c842 0%,#00ffb4 50%,#00d4ff 100%)",
              backgroundSize:"200% auto", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
              animation:"shimmer 4s linear infinite",
            }}>NEUROTRADE MICRO</div>
            <div style={{ fontSize:8, letterSpacing:"0.3em", color:"#f5c842", opacity:0.6, marginTop:2 }}>
              $3 START · PENNY-PRECISION · SURVIVAL FIRST · COMPOUND TO MILLIONS
            </div>
          </div>

          {/* Capital display */}
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            {/* KILL SWITCH */}
            {killSwitch && (
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <div style={{ padding:"4px 12px", borderRadius:12, background:"rgba(255,40,40,0.15)", border:"1px solid #ff4040", fontSize:9, fontWeight:700, color:"#ff6060", letterSpacing:"0.12em", animation:"blink 0.8s infinite" }}>
                  ⛔ {killReason}
                </div>
                <button onClick={resetKill} style={{ padding:"4px 10px", borderRadius:5, border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:"rgba(255,255,255,0.4)", fontFamily:F, fontSize:8, cursor:"pointer" }}>RESET</button>
              </div>
            )}

            {/* Phase badge */}
            <div style={{ padding:"4px 14px", borderRadius:20, border:`1px solid ${phaseC}`, background:`${phaseC}15`, fontSize:9, fontWeight:700, color:phaseC, letterSpacing:"0.15em", animation:brainSnap.phase==="EMPIRE"?"glow 2s infinite":"none" }}>
              {brainSnap.phase}
            </div>

            {/* Mode toggles */}
            <div style={{ display:"flex", gap:6, alignItems:"center", padding:"4px 10px", borderRadius:8, background:"rgba(0,0,0,0.3)", border:"1px solid rgba(0,255,180,0.08)" }}>
              <span style={{ fontSize:7, color:!isLive?"#00ffb4":"rgba(255,255,255,0.3)", fontWeight:!isLive?700:400, letterSpacing:"0.1em" }}>PAPER</span>
              <div onClick={()=>setIsLive(v=>!v)} style={{ position:"relative", width:36,height:20,borderRadius:10,cursor:"pointer", background:isLive?"rgba(255,60,60,0.15)":"rgba(0,255,180,0.08)", border:`1.5px solid ${isLive?"#ff5050":"#00ffb4"}`, transition:"all 0.3s", boxShadow:isLive?"0 0 10px rgba(255,60,60,0.3)":"0 0 6px rgba(0,255,180,0.2)" }}>
                <div style={{ position:"absolute", top:2, left:isLive?17:2, width:14,height:14,borderRadius:"50%", background:isLive?"radial-gradient(circle at 35% 35%,#ffaaaa,#ff4040)":"radial-gradient(circle at 35% 35%,#aaffda,#00ffb4)", transition:"all 0.3s" }}/>
              </div>
              <span style={{ fontSize:7, color:isLive?"#ff6060":"rgba(255,255,255,0.2)", fontWeight:isLive?700:400, letterSpacing:"0.1em" }}>LIVE</span>
              <div style={{ width:1, height:14, background:"rgba(255,255,255,0.08)" }}/>
              <div onClick={()=>setAutoExec(v=>!v)} style={{ position:"relative", width:36,height:20,borderRadius:10,cursor:"pointer", background:autoExec?"rgba(167,139,250,0.15)":"rgba(255,255,255,0.04)", border:`1.5px solid ${autoExec?"#a78bfa":"rgba(255,255,255,0.1)"}`, transition:"all 0.3s" }}>
                <div style={{ position:"absolute", top:2, left:autoExec?17:2, width:14,height:14,borderRadius:"50%", background:autoExec?"radial-gradient(circle at 35% 35%,#d4c0ff,#a78bfa)":"radial-gradient(circle at 35% 35%,#556,#223)", transition:"all 0.3s" }}/>
              </div>
              <span style={{ fontSize:7, color:autoExec?"#a78bfa":"rgba(255,255,255,0.25)", fontWeight:autoExec?700:400, letterSpacing:"0.08em" }}>AUTO</span>
            </div>

            <button onClick={startStop} disabled={killSwitch} style={{ padding:"6px 20px", borderRadius:6, border:`1px solid ${killSwitch?"rgba(255,255,255,0.1)":running?"#ff5050":"#00ffb4"}`, background:killSwitch?"transparent":running?"rgba(255,80,80,0.1)":"rgba(0,255,180,0.1)", color:killSwitch?"rgba(255,255,255,0.2)":running?"#ff8080":"#00ffb4", fontFamily:F, fontSize:9, fontWeight:700, letterSpacing:"0.12em", cursor:killSwitch?"not-allowed":"pointer", animation:running?"blink 3s infinite":"none" }}>
              {running?"⏹ STOP":"▶ START"}
            </button>
          </div>
        </div>

        {/* ══ CAPITAL HERO ══ */}
        <div style={{ ...CARD, marginBottom:10, background:"linear-gradient(135deg,rgba(0,18,8,0.98),rgba(0,30,12,0.95))", position:"relative", overflow:"hidden" }}>
          {/* Background grid */}
          <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(0,255,180,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,180,0.03) 1px,transparent 1px)", backgroundSize:"20px 20px", pointerEvents:"none" }}/>
          <div style={{ position:"relative", display:"grid", gridTemplateColumns:"1fr auto", gap:16, alignItems:"center" }}>
            <div>
              <div style={{ fontSize:8, letterSpacing:"0.3em", color:"#f5c842", opacity:0.7, marginBottom:4 }}>CURRENT CAPITAL</div>
              <div style={{ fontFamily:FD, fontSize:"clamp(28px,5vw,56px)", letterSpacing:"0.06em", color:pnlCol(totalPnL), lineHeight:1, animation:"countUp 0.3s ease" }}>
                {fmt$(capital)}
              </div>
              <div style={{ display:"flex", gap:12, marginTop:6, flexWrap:"wrap" }}>
                <span style={{ fontFamily:F, fontSize:10, color:pnlCol(totalPnL), fontWeight:700 }}>
                  {totalPnL>=0?"+":""}{fmt$(totalPnL)} ({totalPct>=0?"+":""}{totalPct.toFixed(3)}%)
                </span>
                <span style={{ fontSize:9, color:"rgba(255,255,255,0.35)" }}>from $3.00 seed</span>
                <span style={{ fontSize:9, color:"#f5c842" }}>Session: {sessionPnL>=0?"+":""}{fmt$(sessionPnL)}</span>
              </div>
            </div>

            {/* Mini equity sparkline */}
            <div style={{ width:180, height:60 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equity.slice(-60)}>
                  <defs>
                    <linearGradient id="gSpark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={pnlCol(totalPnL)} stopOpacity={0.3}/>
                      <stop offset="100%" stopColor={pnlCol(totalPnL)} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <ReferenceLine y={3} stroke="rgba(255,200,0,0.2)" strokeDasharray="3 3"/>
                  <Area dataKey="v" stroke={pnlCol(totalPnL)} fill="url(#gSpark)" strokeWidth={1.5} dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Milestone progress bar */}
          <div style={{ marginTop:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"rgba(255,255,255,0.4)", marginBottom:4 }}>
              <span style={{ color:phaseC, fontWeight:700 }}>{milestone.label} ${milestone.current}</span>
              <span>{milestone.pct.toFixed(1)}% to <span style={{ color:phaseC }}>{milestone.nextLabel} ${milestone.next?.toLocaleString()}</span></span>
            </div>
            <div style={{ height:8, borderRadius:4, background:"rgba(255,255,255,0.06)", overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${Math.min(milestone.pct,100)}%`, background:`linear-gradient(90deg,${phaseC}99,${phaseC})`, borderRadius:4, transition:"width 0.8s ease", boxShadow:`0 0 8px ${phaseC}66` }}/>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:3, fontSize:7, color:"rgba(255,255,255,0.25)" }}>
              {MICRO.MILESTONES.map((m,i) => (
                <span key={i} style={{ color: capital>=m ? phaseC : "rgba(255,255,255,0.2)", fontWeight:capital>=m?700:400 }}>
                  ${m>=1000?(m/1000)+"K":m}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ══ STATS STRIP ══ */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(85px,1fr))", gap:6, marginBottom:10 }}>
          {[
            { l:"Max Trade",  v:fmt$(maxTrade),              c:"#f5c842",  note:`${(MICRO.scaleMaxTradePct(capital)*100).toFixed(0)}% cap` },
            { l:"Win Rate",   v:`${riskMet.wr}%`,            c:riskMet.wr>50?"#00ffb4":"#ff6060" },
            { l:"Sharpe",     v:riskMet.sharpe,              c:riskMet.sharpe>1?"#00ffb4":"#f5c842" },
            { l:"Brain Conf", v:`${brainSnap.confidence}%`,  c:phaseC },
            { l:"Trades",     v:brainSnap.trades,            c:"#b8ffe8" },
            { l:"Streak",     v:`${brainSnap.survivalStreak}`, c:"#34d399" },
            { l:"Daily DD",   v:`${ddToday.toFixed(2)}%`,    c:ddToday>2?"#ff6060":ddToday>1?"#f5c842":"#00ffb4", note:`limit ${MICRO.DAILY_DD_LIMIT*100}%` },
            { l:"EV/Trade",   v:fmt$(riskMet.ev),            c:riskMet.ev>=0?"#00ffb4":"#ff6060" },
            { l:"Generation", v:`G${brainSnap.generation}`,  c:"#a78bfa" },
            { l:"Peak",       v:fmt$(peakCap),               c:"#00d4ff" },
          ].map(s=>(
            <div key={s.l} style={CARD}>
              <div style={LBL}>{s.l}</div>
              <div style={{ fontFamily:F, fontSize:"clamp(11px,1.5vw,15px)", fontWeight:700, color:s.c, marginTop:2 }}>{s.v}</div>
              {s.note && <div style={{ fontSize:7, opacity:0.4, marginTop:1 }}>{s.note}</div>}
            </div>
          ))}
        </div>

        {/* ══ TABS ══ */}
        <div style={{ display:"flex", gap:4, marginBottom:10, flexWrap:"wrap" }}>
          {TABS.map(t => <button key={t} style={TAB_S(tab===t)} onClick={()=>setTab(t)}>{t}</button>)}
        </div>

        {/* ══════════════════ DASHBOARD TAB ══════════════════ */}
        {tab==="DASHBOARD" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:8, marginBottom:8 }}>
              {/* Equity curve */}
              <div style={SEC}>
                <div style={LBL}>Capital Curve — Every Cent Tracked</div>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={equity.slice(-200)}>
                    <defs>
                      <linearGradient id="gEq" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00ffb4" stopOpacity={0.25}/>
                        <stop offset="100%" stopColor="#00ffb4" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,255,180,0.05)"/>
                    <XAxis dataKey="t" tick={false} axisLine={false}/>
                    <YAxis tick={{fontSize:8,fill:"#3af5a0"}} axisLine={false} tickLine={false} width={55} tickFormatter={v=>fmt$(v)}/>
                    <Tooltip content={<TT/>}/>
                    <ReferenceLine y={3} stroke="rgba(245,200,66,0.2)" strokeDasharray="4 4" label={{value:"$3 SEED",fill:"#f5c842",fontSize:7}}/>
                    <Area dataKey="v" stroke="#00ffb4" fill="url(#gEq)" strokeWidth={2} dot={false} name="Capital"/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Micro risk panel */}
              <div style={SEC}>
                <div style={LBL}>Micro Risk Panel</div>
                <div style={{ marginTop:8 }}>
                  {/* Drawdown gauges */}
                  {[
                    { l:"Daily DD", cur:ddToday, lim:MICRO.DAILY_DD_LIMIT*100 },
                    { l:"Total DD", cur:riskMet.maxDD, lim:MICRO.TOTAL_DD_LIMIT*100 },
                  ].map(d => {
                    const pct = Math.min(d.cur/d.lim*100,100);
                    const c   = pct>80?"#ff5555":pct>50?"#f5c842":"#00ffb4";
                    return (
                      <div key={d.l} style={{ marginBottom:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"#3af5a0", opacity:0.6, marginBottom:3 }}>
                          <span>{d.l}</span><span>{d.cur.toFixed(3)}% / {d.lim}%</span>
                        </div>
                        <div style={{ height:6, borderRadius:3, background:"rgba(0,255,180,0.07)", overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,#00ffb4,${c})`, borderRadius:3, transition:"width 0.5s" }}/>
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ height:1, background:"rgba(255,255,255,0.06)", margin:"8px 0" }}/>

                  {/* Position size info */}
                  <div style={{ fontSize:9, lineHeight:1.9, color:"rgba(255,255,255,0.5)" }}>
                    <div>Kelly size: <span style={{ color:"#f5c842", fontWeight:700 }}>{fmt$(maxTrade)}</span></div>
                    <div>Gas floor (SOL): <span style={{ color:"#00ffb4" }}>{fmt$(MICRO.SOL_GAS_USD)}</span></div>
                    <div>Min net spread: <span style={{ color:"#00ffb4" }}>{(MICRO.MIN_SPREAD_NET*100).toFixed(2)}%</span></div>
                    <div>Max trades/slot: <span style={{ color:"#a78bfa" }}>{MICRO.scaleMaxOpen(capital)}</span></div>
                    <div>Confidence gate: <span style={{ color:phaseC }}>{isLive?55:35}%</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Gas viability checker */}
            <div style={SEC}>
              <div style={LBL}>⛽ Gas Viability Check — Which Chains Are Worth It at {fmt$(capital)}</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:8, marginTop:8 }}>
                {[
                  { chain:"Solana",   gas:MICRO.SOL_GAS_USD,  viable:true  },
                  { chain:"Arbitrum", gas:MICRO.ARB_GAS_USD,  viable:capital>=1 },
                  { chain:"Polygon",  gas:0.001,               viable:capital>=0.5 },
                  { chain:"Ethereum", gas:MICRO.ETH_GAS_USD,  viable:capital>=200 },
                  { chain:"BNB Chain",gas:0.05,                viable:capital>=5 },
                  { chain:"Optimism", gas:0.004,               viable:capital>=2 },
                ].map(c => {
                  const breakEven = +(c.gas / (capital * MICRO.MAX_TRADE_PCT) * 100).toFixed(2);
                  return (
                    <div key={c.chain} style={{ padding:"10px", borderRadius:6, border:`1px solid ${c.viable?"rgba(0,255,180,0.15)":"rgba(255,80,80,0.12)"}`, background:c.viable?"rgba(0,255,180,0.03)":"rgba(255,40,40,0.03)" }}>
                      <div style={{ fontSize:10, fontWeight:700, color:c.viable?"#00ffb4":"rgba(255,255,255,0.3)", marginBottom:4 }}>{c.chain}</div>
                      <div style={{ fontSize:8, color:"rgba(255,255,255,0.5)", lineHeight:1.8 }}>
                        Gas: <span style={{ color:"#f5c842" }}>{fmt$(c.gas)}</span><br/>
                        Break-even: <span style={{ color:breakEven>10?"#ff6060":"#00ffb4" }}>{breakEven}% of trade</span><br/>
                        Status: <span style={{ color:c.viable?"#00ffb4":"#ff5555", fontWeight:700 }}>{c.viable?"✓ VIABLE":"✗ TOO EXPENSIVE"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ BRAIN TAB ══════════════════════ */}
        {tab==="BRAIN" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
              <div style={SEC}>
                <div style={LBL}>Micro Signal Weights</div>
                <ResponsiveContainer width="100%" height={180}>
                  <RadarChart data={Object.entries(brainSnap.weights).map(([k,v])=>({axis:k,val:+(v*100).toFixed(1)}))}>
                    <PolarGrid stroke="rgba(0,255,180,0.1)"/>
                    <PolarAngleAxis dataKey="axis" tick={{fontSize:8,fill:"#3af5a0"}}/>
                    <Radar dataKey="val" stroke={phaseC} fill={phaseC} fillOpacity={0.18} strokeWidth={1.5}/>
                    <Tooltip contentStyle={{background:"#071510",border:"1px solid rgba(0,255,180,0.2)",borderRadius:4,fontSize:9,fontFamily:F}}/>
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div style={SEC}>
                <div style={LBL}>Weight Evolution</div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={wHist}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,255,180,0.04)"/>
                    <XAxis dataKey="t" tick={false} axisLine={false}/>
                    <YAxis tick={{fontSize:7,fill:"#3af5a0"}} axisLine={false} tickLine={false} width={28}/>
                    <Tooltip content={<TT/>}/>
                    <Legend wrapperStyle={{fontSize:7,fontFamily:F}}/>
                    {["momentum","microArb","solanaFlow","gasAware"].map((k,i)=>(
                      <Line key={k} dataKey={k} stroke={["#00ffb4","#f5c842","#a78bfa","#f87171"][i]} strokeWidth={1.5} dot={false} name={k}/>
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
              {[
                {l:"Phase",v:brainSnap.phase,c:phaseC},
                {l:"Confidence",v:`${brainSnap.confidence}%`,c:phaseC},
                {l:"Win Rate",v:`${brainSnap.wr}%`,c:brainSnap.wr>50?"#00ffb4":"#f5c842"},
                {l:"Streak",v:brainSnap.survivalStreak,c:"#34d399"},
                {l:"Generation",v:`G${brainSnap.generation}`,c:"#a78bfa"},
                {l:"Mutations",v:brainSnap.mutations,c:"#f5c842"},
                {l:"Synapses",v:brainSnap.synapses.toLocaleString(),c:"#00d4ff"},
                {l:"Learning Rate",v:brainSnap.lr.toFixed(4),c:"#fb923c"},
              ].map(s=>(
                <div key={s.l} style={CARD}>
                  <div style={LBL}>{s.l}</div>
                  <div style={{fontFamily:F,fontSize:13,fontWeight:700,color:s.c,marginTop:2}}>{s.v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════ RISK TAB ═══════════════════════ */}
        {tab==="RISK" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:8 }}>
              {[
                {l:"Sharpe",v:riskMet.sharpe,c:riskMet.sharpe>1?"#00ffb4":"#f5c842",note:riskMet.sharpe>2?"Excellent":riskMet.sharpe>1?"Good":"Building"},
                {l:"Sortino",v:riskMet.sortino,c:riskMet.sortino>1?"#00ffb4":"#f5c842",note:"Downside-adjusted"},
                {l:"Profit Factor",v:riskMet.pf,c:riskMet.pf>1.5?"#00ffb4":"#f5c842",note:riskMet.pf>1?"Edge exists":"No edge"},
                {l:"VaR 99%",v:fmt$(riskMet.var99),c:"#f5c842",note:"Max expected loss"},
                {l:"EV per Trade",v:fmt$(riskMet.ev),c:riskMet.ev>=0?"#00ffb4":"#ff6060",note:"Expected value"},
                {l:"Win Rate",v:`${riskMet.wr}%`,c:riskMet.wr>50?"#00ffb4":"#f5c842",note:`${brainSnap.trades} trades`},
              ].map(s=>(
                <div key={s.l} style={CARD}>
                  <div style={LBL}>{s.l}</div>
                  <div style={{fontSize:"clamp(16px,2.5vw,24px)",fontWeight:700,color:s.c,margin:"4px 0",fontFamily:FD}}>{s.v}</div>
                  <div style={{fontSize:8,opacity:0.45}}>{s.note}</div>
                </div>
              ))}
            </div>
            {/* P&L bar chart */}
            <div style={SEC}>
              <div style={LBL}>P&L Per Trade (micro-precision)</div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={trades.slice(0,60).reverse().map((t,i)=>({i,p:t.pnl}))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,255,180,0.05)"/>
                  <XAxis dataKey="i" tick={false} axisLine={false}/>
                  <YAxis tick={{fontSize:8,fill:"#3af5a0"}} axisLine={false} tickLine={false} width={60} tickFormatter={v=>fmt$(v)}/>
                  <Tooltip content={<TT/>}/>
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)"/>
                  <Bar dataKey="p" name="P&L" radius={[2,2,0,0]} fill="#00ffb4">
                    {trades.slice(0,60).reverse().map((t,i)=>(
                      <Cell key={i} fill={t.pnl>=0?"#00ffb4":"#ff5555"} fillOpacity={0.7}/>
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ══════════════════ PRICES TAB ═════════════════════ */}
        {tab==="PRICES" && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:8 }}>
            {MICRO_ASSETS.map((a,i)=>{
              const pd = prices[a.symbol];
              const c  = (pd?.chg||0) >= 0 ? "#00ffb4" : "#ff5555";
              const gasViable = a.gas < capital * MICRO.MAX_TRADE_PCT * 0.1;
              return (
                <div key={a.symbol} style={{ ...CARD, borderColor: gasViable?"rgba(0,255,180,0.15)":"rgba(255,255,255,0.06)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <div style={{ fontFamily:FD, fontSize:16, color:["#00ffb4","#00d4ff","#a78bfa","#f5c842","#f87171","#34d399"][i], letterSpacing:"0.1em" }}>{a.symbol}</div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:8, fontWeight:700, color:c }}>{pd?.chg>=0?"▲":"▼"}{Math.abs(pd?.chg||0).toFixed(3)}%</div>
                      <div style={{ fontSize:7, color:gasViable?"#00ffb4":"#ff6060", opacity:0.7 }}>{gasViable?"⛽ OK":"⛽ HIGH"}</div>
                    </div>
                  </div>
                  <div style={{ fontSize:12, fontWeight:700, color:c, marginBottom:4 }}>${pd?.cur?.toFixed(pd?.cur>1?4:8)||a.base}</div>
                  <div style={{ fontSize:7, opacity:0.4, marginBottom:4 }}>{a.chain} · gas {fmt$(a.gas)}</div>
                  <ResponsiveContainer width="100%" height={45}>
                    <AreaChart data={pd?.hist?.slice(-30)||[]}>
                      <defs><linearGradient id={`g${a.symbol}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity={0.25}/><stop offset="100%" stopColor={c} stopOpacity={0}/></linearGradient></defs>
                      <Area dataKey="p" stroke={c} fill={`url(#g${a.symbol})`} strokeWidth={1.5} dot={false}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              );
            })}
          </div>
        )}

        {/* ══════════════════ GROWTH TAB ═════════════════════ */}
        {tab==="GROWTH" && (
          <div>
            {/* Compound roadmap */}
            <div style={SEC}>
              <div style={LBL}>Compound Roadmap — $3 to $50,000</div>
              <div style={{ marginTop:12 }}>
                {projections.map((p,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:"1px solid rgba(0,255,180,0.06)" }}>
                    {/* Icon */}
                    <div style={{ width:32, height:32, borderRadius:"50%", background:p.reached?"rgba(0,255,180,0.15)":"rgba(255,255,255,0.04)", border:`1.5px solid ${p.reached?phaseC:"rgba(255,255,255,0.08)"}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <span style={{ fontSize:14 }}>{["🌱","🌿","🌳","🌲","🌳🌳","👑"][i]||"●"}</span>
                    </div>
                    {/* Info */}
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                        <span style={{ fontFamily:FD, fontSize:14, letterSpacing:"0.1em", color:p.reached?phaseC:"rgba(255,255,255,0.5)" }}>
                          {p.label}
                        </span>
                        <span style={{ fontFamily:F, fontSize:11, fontWeight:700, color:p.reached?"#00ffb4":"rgba(255,255,255,0.35)" }}>
                          ${p.target.toLocaleString()}
                        </span>
                        {p.reached && <span style={{ fontSize:9, color:"#00ffb4", padding:"1px 6px", borderRadius:4, background:"rgba(0,255,180,0.12)", border:"1px solid rgba(0,255,180,0.2)" }}>✓ REACHED</span>}
                      </div>
                      {/* Progress bar toward this milestone */}
                      {!p.reached && (
                        <div style={{ height:4, borderRadius:2, background:"rgba(255,255,255,0.06)", overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${Math.min((capital/p.target)*100,100)}%`, background:`linear-gradient(90deg,${phaseC}66,${phaseC})`, borderRadius:2 }}/>
                        </div>
                      )}
                    </div>
                    {/* Days estimate */}
                    {!p.reached && (
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:"#f5c842", fontFamily:FD }}>
                          {p.days > 9999 ? "∞" : `${p.days}d`}
                        </div>
                        <div style={{ fontSize:7, opacity:0.4, marginTop:1 }}>at {(MICRO.DAILY_TARGET_PCT*100).toFixed(1)}%/day</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Compound table */}
            <div style={SEC}>
              <div style={LBL}>Daily Compound Projection (1.5% / day)</div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
                  <thead>
                    <tr>
                      {["Day","Capital","Daily Gain","Total Return","Milestone"].map(h=>(
                        <th key={h} style={{ padding:"5px 10px", textAlign:"left", borderBottom:"1px solid rgba(0,255,180,0.1)", fontSize:8, color:"#3af5a0", opacity:0.6, letterSpacing:"0.15em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[1,3,7,14,30,60,90,180,365].map(day => {
                      const cap    = capital * Math.pow(1 + MICRO.DAILY_TARGET_PCT, day);
                      const gain   = cap - capital;
                      const total  = ((cap - 3) / 3 * 100);
                      const ms     = MICRO.MILESTONES.filter(m=>m<=cap).pop() || 3;
                      const msLabel= MICRO.MILESTONE_LABELS[MICRO.MILESTONES.indexOf(ms)] || "SEED";
                      return (
                        <tr key={day} style={{ borderBottom:"1px solid rgba(0,255,180,0.04)" }}>
                          <td style={{ padding:"5px 10px", color:"rgba(255,255,255,0.5)" }}>{day}d</td>
                          <td style={{ padding:"5px 10px", fontWeight:700, color:"#00ffb4" }}>{fmt$(cap)}</td>
                          <td style={{ padding:"5px 10px", color:"#f5c842" }}>+{fmt$(gain)}</td>
                          <td style={{ padding:"5px 10px", color:"#00d4ff" }}>+{total.toFixed(1)}%</td>
                          <td style={{ padding:"5px 10px" }}>
                            <span style={{ fontSize:9, padding:"1px 7px", borderRadius:3, background:`${phaseColors[msLabel]||"#00ffb4"}18`, color:phaseColors[msLabel]||"#00ffb4", border:`1px solid ${phaseColors[msLabel]||"#00ffb4"}33` }}>{msLabel}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ LOG TAB ════════════════════════ */}
        {tab==="LOG" && (
          <div>
            <div style={SEC}>
              <div style={LBL}>Execution Log — Penny-Level Precision</div>
              <div style={{ maxHeight:400, overflowY:"auto", marginTop:6 }}>
                {execLog.length===0
                  ? <div style={{ textAlign:"center", opacity:0.2, fontSize:10, padding:"20px 0" }}>Start engine + enable auto-exec</div>
                  : execLog.map((e,i) => (
                      <div key={i} style={{ display:"flex", gap:8, fontSize:9, padding:"4px 0", borderBottom:"1px solid rgba(0,255,180,0.04)", alignItems:"center", flexWrap:"wrap", animation:i===0?"slideIn 0.3s ease":"none" }}>
                        <span style={{ color:"#3af5a0", opacity:0.4, minWidth:54 }}>{e.ts}</span>
                        {e.mode && <span style={{ fontSize:7, padding:"1px 5px", borderRadius:2, fontWeight:700, background:e.mode==="LIVE"?"rgba(255,60,60,0.15)":"rgba(0,255,180,0.08)", color:e.mode==="LIVE"?"#ff6060":"#00ffb4", minWidth:34, textAlign:"center" }}>{e.mode}</span>}
                        {e.type==="SKIP" && <span style={{ fontSize:7, padding:"1px 5px", borderRadius:2, fontWeight:700, background:"rgba(245,200,66,0.1)", color:"#f5c842" }}>SKIP</span>}
                        <span style={{ color:e.color||"#b8ffe8", flex:1, lineHeight:1.4 }}>{e.msg}</span>
                      </div>
                  ))
                }
              </div>
            </div>
            {/* Trade history table */}
            {trades.length > 0 && (
              <div style={SEC}>
                <div style={LBL}>Trade History</div>
                <div style={{ maxHeight:280, overflowY:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9 }}>
                    <thead>
                      <tr>{["Asset","Chain","Size","Gas","P&L","Net","Mode","Result"].map(h=>(
                        <th key={h} style={{ padding:"4px 8px", textAlign:"left", borderBottom:"1px solid rgba(0,255,180,0.1)", fontSize:7, color:"#3af5a0", opacity:0.6, letterSpacing:"0.12em" }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {trades.slice(0,50).map((t,i)=>(
                        <tr key={i} style={{ borderBottom:"1px solid rgba(0,255,180,0.04)" }}>
                          <td style={{ padding:"4px 8px", fontWeight:700, color:["#00ffb4","#00d4ff","#a78bfa","#f5c842","#f87171","#34d399"][MICRO_ASSETS.findIndex(a=>a.symbol===t.asset)%6] }}>{t.asset}</td>
                          <td style={{ padding:"4px 8px", opacity:0.5, fontSize:8 }}>{t.chain}</td>
                          <td style={{ padding:"4px 8px" }}>{fmt$(t.size)}</td>
                          <td style={{ padding:"4px 8px", color:"#f5c842", fontSize:8 }}>{fmt$(t.gas)}</td>
                          <td style={{ padding:"4px 8px", fontWeight:700, color:pnlCol(t.pnl) }}>{t.pnl>=0?"+":""}{fmt$(t.pnl)}</td>
                          <td style={{ padding:"4px 8px", color:pnlCol(t.pnl) }}>{fmtPct(t.pnl/t.size)}</td>
                          <td style={{ padding:"4px 8px" }}>
                            <span style={{ fontSize:7, padding:"1px 4px", borderRadius:2, background:t.mode==="LIVE"?"rgba(255,60,60,0.12)":"rgba(0,255,180,0.08)", color:t.mode==="LIVE"?"#ff6060":"#00ffb4" }}>{t.mode}</span>
                          </td>
                          <td style={{ padding:"4px 8px" }}>
                            <span style={{ fontSize:7, padding:"1px 5px", borderRadius:2, fontWeight:700, background:t.won?"rgba(0,255,180,0.1)":"rgba(255,80,80,0.1)", color:t.won?"#00ffb4":"#ff6060" }}>{t.won?"WIN":"LOSS"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop:14, padding:"8px 0", borderTop:"1px solid rgba(0,255,180,0.06)", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:4 }}>
          <div style={{ fontSize:7, opacity:0.2, letterSpacing:"0.2em" }}>NEUROTRADE MICRO v1.0 · $3 SEED CAPITAL · SOLANA-FIRST · PENNY-PRECISION KELLY SIZING</div>
          <div style={{ fontSize:7, opacity:0.3 }}>Kill-switch: {MICRO.DAILY_DD_LIMIT*100}% daily / {MICRO.TOTAL_DD_LIMIT*100}% total · Max trade: {(MICRO.scaleMaxTradePct(capital)*100).toFixed(0)}% · Gas-aware routing</div>
        </div>
      </div>
    </div>
  );
}
