import { BellRing, ClipboardCheck, ShoppingBasket } from "lucide-react";
import { LoginForm } from "@/components/app/login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main style={{ minHeight:"100vh", background:"#07080F", position:"relative", overflow:"hidden" }}>
      {/* Background gradient blobs */}
      <div style={{ position:"absolute", top:"-120px", right:"-80px", width:"600px", height:"600px",
        borderRadius:"50%", pointerEvents:"none",
        background:"radial-gradient(circle, rgba(91,115,247,0.18) 0%, transparent 65%)",
        filter:"blur(60px)" }} />
      <div style={{ position:"absolute", bottom:"-80px", left:"-60px", width:"400px", height:"400px",
        borderRadius:"50%", pointerEvents:"none",
        background:"radial-gradient(circle, rgba(91,115,247,0.09) 0%, transparent 70%)",
        filter:"blur(50px)" }} />
      {/* Dot grid */}
      <div style={{ position:"absolute", inset:0, pointerEvents:"none",
        backgroundImage:"radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)",
        backgroundSize:"24px 24px" }} />

      <div style={{ position:"relative", maxWidth:"1200px", margin:"0 auto",
        padding:"0 24px", minHeight:"100vh",
        display:"grid", gridTemplateColumns:"1fr", alignItems:"center",
        gap:"48px" }}
        className="lg:grid-cols-[1fr_400px]">

        {/* Left — value prop */}
        <section className="anim-fade-up" style={{ paddingTop:"48px", paddingBottom:"48px" }}>
          {/* Eyebrow */}
          <span style={{ display:"inline-flex", alignItems:"center", gap:"6px",
            border:"1px solid rgba(91,115,247,0.30)",
            background:"rgba(91,115,247,0.10)",
            borderRadius:"100px", padding:"5px 14px",
            fontSize:"11px", fontWeight:700, letterSpacing:"0.14em",
            textTransform:"uppercase", color:"#7B93FF" }}>
            Inventory operating system
          </span>

          {/* Headline */}
          <h1 style={{ marginTop:"28px",
            fontSize:"clamp(2.8rem, 6vw, 4.2rem)", fontWeight:800,
            letterSpacing:"-0.05em", lineHeight:"1.02",
            background:"linear-gradient(160deg, #ffffff 0%, rgba(255,255,255,0.55) 100%)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            backgroundClip:"text", maxWidth:"640px" }}>
            Run your cafe inventory with the clarity it deserves.
          </h1>

          <p style={{ marginTop:"20px", fontSize:"16px", lineHeight:1.65,
            color:"#5A6285", maxWidth:"460px" }}>
            See what needs attention, count what looks off, and approve supplier orders —
            without digging through heavy back-office screens.
          </p>

          {/* Feature pills */}
          <div style={{ marginTop:"36px", display:"flex", flexWrap:"wrap", gap:"10px" }}>
            {[
              { icon:BellRing,       label:"Smart alerts" },
              { icon:ClipboardCheck, label:"Fast stock counts" },
              { icon:ShoppingBasket, label:"Approval-first orders" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} style={{ display:"flex", alignItems:"center", gap:"8px",
                borderRadius:"100px", padding:"8px 16px",
                border:"1px solid rgba(255,255,255,0.08)",
                background:"rgba(255,255,255,0.03)" }}>
                <Icon style={{ width:13, height:13, color:"#7B93FF" }} />
                <span style={{ fontSize:"13px", fontWeight:500, color:"#A0AACC" }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Flow steps */}
          <div style={{ marginTop:"48px", display:"grid", gridTemplateColumns:"repeat(3,1fr)",
            gap:"20px", maxWidth:"480px" }}>
            {[
              { n:"01", title:"Open Home",    body:"Check what's urgent." },
              { n:"02", title:"Count fast",   body:"Swipe or list mode." },
              { n:"03", title:"Approve",      body:"Review, adjust, send." },
            ].map(({ n, title, body }) => (
              <div key={n} style={{
                borderRadius:"14px", padding:"1px",
                background:"linear-gradient(145deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 55%, rgba(91,115,247,0.12) 100%)",
              }}>
                <div style={{ borderRadius:"13px", background:"#0D0E1A", padding:"18px 16px" }}>
                  <p style={{ fontSize:"10px", fontWeight:800, color:"#7B93FF", letterSpacing:"0.1em",
                    fontVariantNumeric:"tabular-nums" }}>{n}</p>
                  <p style={{ marginTop:"10px", fontSize:"13px", fontWeight:700,
                    letterSpacing:"-0.02em", color:"#F0F2FC" }}>{title}</p>
                  <p style={{ marginTop:"4px", fontSize:"12px", color:"#5A6285" }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Right — login form */}
        <div className="anim-fade-up d-150" style={{ paddingTop:"48px", paddingBottom:"48px" }}>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
