// Som: tudo sintetizado na hora, sem amostra gravada. O núcleo (sndCore) é JavaScript puro e determinístico: o mesmo
// código roda dentro de um AudioWorklet (jogo em tempo real) e fora do tempo real (trilha do vídeo e testes), sempre a
// partir de 16 controles inteiros tirados da simulação (sndControl). Nenhuma alocação por bloco de áudio nem por quadro.
//
// Controles (inteiros; no jogo viajam como AudioParams de taxa k, um número por bloco):
//  0 bits: 1 = jogo andando (0 = pausa: a saída some e o estado congela), 2 = mudo, 4/8 = câmera (0 perseguição, 1 capô, 2 TV)
//  1 giro (rpm)   2 acelerador ×1000   3 marcha (0 = ré)   4 velocidade do carro (cm/s)
//  5/6 canto de pneu esquerdo/direito ×1000   7 rodas na grama/brita ×1000   8 rodas na zebra ×1000
//  9 distância do ouvinte ao carro (dm)   10 fator Doppler ×10000   11 velocidade do ouvinte (cm/s)
//  12 proximidade da arquibancada ×1000   13 lado da arquibancada ×1000 (-1000 esquerda .. 1000 direita)   14 contador de batidas
// Camadas (mix[i]): 0 motor, 1 pneus (canto), 2 vento, 3 rodagem (piso, zebra, brita, batida), 4 ambiente (mata, pássaros), 5 público.
// Níveis: VOL é o volume geral, aplicado na saída, depois do limitador (o timbre e a dinâmica não mudam com ele); AMB é o
// ganho a mais das camadas de ambiente (mata, pássaros e público) em relação ao resto.
function sndCore(sr) {
  const VOL = 0.4, AMB = 0.5;
  const NC = 32, PI = Math.PI, NPH = 40, PH0 = 128, ctl = new Float32Array(16), st = new Float64Array(PH0 + NPH * 22), F = new Float64Array(120), Z = new Float64Array(80);
  const RS = new Int32Array(2), BI = new Int32Array(6), PHN = new Int32Array(NPH), mix = new Float32Array(6).fill(1);
  const mk = () => new Float32Array(NC);
  const wA = mk(), wB = mk(), ex = mk(), ni = mk(), tk = mk(), eg = mk(), cb = mk(), sL = mk(), sR = mk(), t1 = mk(), t2 = mk(), oL = mk(), oR = mk();
  const L2 = mk(), R2 = mk(), L4 = mk(), R4 = mk(), L5 = mk(), R5 = mk();   // barramentos estéreo: vento, ambiente, público
  const CG = new Float64Array([1, 0.8, 0.92, 0.74]);  // cilindros desiguais: dão as meias-ordens (o "ronco" de quatro cilindros)
  // ganhos dos ressonadores do motor por câmera: [direto, 105, 235, 470, 980, 2100 Hz, admissão, tuchos]
  const VG = new Float64Array([0.45, 1.0, 0.85, 0.6, 0.46, 0.26, 0.34, 0.06, 0.4, 0.55, 0.7, 0.85, 0.7, 0.42, 0.7, 0.3, 0.45, 0.8, 0.8, 0.7, 0.55, 0.32, 0.4, 0.1]);
  const kc = t => 1 - Math.exp(-NC / (sr * t)), K8 = kc(0.008), K20 = kc(0.02), K50 = kc(0.05), K200 = kc(0.2), K30 = kc(0.03);
  const fset = (k, hz, Q, g) => { F[3 * k] = 2 * Math.sin(PI * Math.min(hz, sr * 0.16) / sr); F[3 * k + 1] = 1 / Q; F[3 * k + 2] = g; };
  // filtros fixos
  fset(0, 22, 0.7, 1); fset(1, 105, 2.2, 1); fset(2, 235, 3, 1); fset(3, 470, 3.5, 1); fset(4, 980, 3, 1); fset(5, 2100, 2.5, 1); fset(6, 1400, 1.1, 1); fset(7, 3400, 0.8, 1);
  fset(8, 1900, 1.4, 1); fset(9, 1900, 1.4, 1);      // raspado do pneu E/D
  fset(10, 300, 0.7, 1); fset(11, 300, 0.7, 1);       // vento E/D (frequência varia)
  fset(12, 200, 0.7, 1);                              // rodagem (varia)
  fset(13, 650, 0.8, 1); fset(14, 2600, 1.6, 1);      // grama/brita: corpo e estalos
  fset(15, 82, 5, 1); fset(16, 310, 2.2, 1);          // zebra
  fset(17, 190, 1.2, 1); fset(18, 1300, 1.5, 1);      // batida
  fset(19, 3100, 0.6, 1); fset(20, 3600, 0.6, 1);     // folhagem E/D
  fset(21, 5200, 22, 1); fset(22, 6300, 26, 1);       // cigarras
  fset(23, 540, 2.4, 1); fset(24, 1150, 3, 0.8); fset(25, 2500, 3, 0.35); fset(26, 600, 2.4, 1); fset(27, 1250, 3, 0.8); fset(28, 2700, 3, 0.35);   // público E/D (formantes de voz)
  fset(29, 1750, 1.1, 1);                             // palmas
  fset(30, 8000, 0.7, 1); fset(31, 8000, 0.7, 1);     // absorção do ar com a distância (varia)
  fset(32, 90, 3, 1);                                 // tranco da troca de marcha
  fset(33, 20, 0.7, 1);                               // tira o nível contínuo que a saturação do motor cria
  // índices do estado
  const MG = 0, RP = 1, LD = 2, FP = 3, AMP = 4, CYL = 5, GP = 6, SHT = 7, DG = 8, DP = 9, SPD = 10, SQ = 11, SQP = 13, SQJ = 15, LSP = 17, GUST = 18, LOO = 19, KRB = 20, KPH = 21,
    CRW = 22, CPN = 23, HIT = 24, HITE = 25, CLK = 26, TM = 27, CRE = 28, VGS = 32, NEXT = 40, BV = 44, FOL = 41, SQA = 100, SQW = 102;
  // estado inicial (também usado para zerar o sintetizador depois do aquecimento)
  function reset() { st.fill(0, 0, PH0); Z.fill(0); BI.fill(0); ctl.fill(0); RS[0] = 0x2F6E2B1; RS[1] = 0x1B873593; st[RP] = 900; st[DG] = 1; st[DP] = 1; st[GP] = 1; st[NEXT] = sr * 0.7; for (let k = 0; k < 8; k++) st[VGS + k] = VG[k]; }
  reset();
  function noise(o) { let x = RS[0]; for (let i = 0; i < NC; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; o[i] = x * 4.656612873e-10; } RS[0] = x; }
  function rnd16() { let x = RS[1]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; RS[1] = x; return (x >>> 8) & 0xffff; }
  // filtro de estado variável em bloco. modo 0 passa-baixa, 1 passa-banda (pico unitário), 2 passa-alta; acc soma em y
  function svf(x, y, m, k, mode, acc) {
    const f = F[3 * k], q = F[3 * k + 1], g = F[3 * k + 2]; let lo = Z[2 * k], bd = Z[2 * k + 1];
    for (let i = 0; i < m; i++) {
      lo += f * bd + 1e-18; const hi = x[i] - lo - q * bd; bd += f * hi;
      const o = (mode === 0 ? lo : mode === 1 ? bd * q : hi) * g;
      if (acc) y[i] += o; else y[i] = o;
    }
    Z[2 * k] = lo; Z[2 * k + 1] = bd;
  }
  // Pássaros: 40 frases calculadas uma vez — até 4 notas de [duração, f0, f1, pausa, vibrato] + volume e posição no estéreo:
  // assobios que deslizam, o bem-te-vi de três notas, trinados. Três vozes sorteiam frases. O disparo de uma nota é código
  // raro (nunca chega a ser otimizado), por isso só usa inteiros e cópias dentro do vetor de estado: assim não aloca nada.
  {
    let q = 20261116; const r = () => (q = (q * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let p = 0; p < NPH; p++) {
      const o = PH0 + p * 22, ty = p % 5 === 0 ? 1 : p % 5 === 1 ? 2 : 0, base = 2300 + 2400 * r(), tr = 0.95 + 0.1 * r(); st[o] = 0.009 + 0.03 * r(); st[o + 1] = r();
      const N = [[0.11, 2350 * tr, 2550 * tr, 0.035, 0], [0.09, 3050 * tr, 2900 * tr, 0.035, 0], [0.27, 2750 * tr, 2050 * tr, 0.035, 0]];
      PHN[p] = ty === 1 ? 3 : ty === 2 ? 1 : 1 + Math.floor(r() * 4);
      for (let k = 0; k < PHN[p]; k++) {
        const f0 = base * (0.92 + 0.16 * r()), n = ty === 1 ? N[k] : ty === 2 ? [0.3 + 0.35 * r(), 3200 + 1700 * r(), 0, 0.3, 380] : [0.07 + 0.14 * r(), f0, f0 * (0.72 + 0.5 * r()), 0.05 + 0.12 * r(), 0];
        if (ty === 2) n[2] = n[1] * 0.96; st.set([n[0] * sr, n[1], n[2], n[3] * sr, n[4]], o + 2 + k * 5);
      }
    }
  }
  // voz v (10 números em st a partir de BV + 10 v): [0] tempo na nota, [1..5] a nota, [6] fase, [8] volume, [9] posição
  function birdNote(v) { const b = BV + v * 10, p = BI[v * 2 + 1]; st.copyWithin(b + 1, p, p + 5); st[b] = 0; BI[v * 2 + 1] = p + 5; }
  function birdStart() {
    for (let v = 0; v < 3; v++) {
      if (BI[v * 2] > 0) continue;
      const p = rnd16() % NPH, o = PH0 + p * 22, b = BV + v * 10; BI[v * 2] = PHN[p]; BI[v * 2 + 1] = o + 2; st.copyWithin(b + 8, o, o + 2); birdNote(v); return;
    }
  }
  function chunk(m) {
    const fl = ctl[0] | 0, view = (fl >> 2) & 3, on = (fl & 3) === 1 ? 1 : 0, mg0 = st[MG];
    if (!on && mg0 < 2e-4) { st[MG] = 0; oL.fill(0); oR.fill(0); return; }   // pausa ou mudo: saída exatamente zero, estado congelado
    const mg1 = mg0 + (on - mg0) * K8 * 1.6; st[MG] = mg1;
    noise(wA); noise(wB);
    // ---- controles suavizados
    const gear = ctl[3] | 0;
    if (gear !== st[GP]) { if (gear > 0 && st[GP] > 0) st[SHT] = 0.21 * sr; st[CLK] = 1; st[GP] = gear; }
    const sht = st[SHT]; if (sht > 0) st[SHT] = sht - m;
    const rp = st[RP] += ((ctl[1] < 600 ? 600 : ctl[1]) - st[RP]) * (sht > 0 ? K50 : K20 * 1.3);
    const ld = st[LD] += ((sht > 0 ? 0.04 : ctl[2] * 0.001) - st[LD]) * (sht > 0 ? K8 * 2 : K20);
    const dp = st[DP] += (ctl[10] * 1e-4 - st[DP]) * K50, dist = ctl[9] * 0.1;
    const dg = st[DG] += (Math.pow(9 / (9 + (dist > 7 ? dist - 7 : 0)), 0.85) - st[DG]) * K20;
    const spd = st[SPD] += (ctl[4] * 0.01 - st[SPD]) * K20, lsp = st[LSP] += (ctl[11] * 0.01 - st[LSP]) * K50;
    for (let k = 0; k < 8; k++) st[VGS + k] += (VG[view * 8 + k] - st[VGS + k]) * K20;
    // ---- motor: um pulso de pressão por explosão (4 por ciclo de 2 voltas), largura em tempo fixo → formantes fixos
    const fc = rp / 30 * dp / sr, ifc = 1 / fc; let tp = (0.0035 - 0.0027 * ld) * sr; if (tp > 0.85 * ifc) tp = 0.85 * ifc;
    const itp = 1 / tp, itk = 1 / (0.0007 * sr), idle = rp < 2500 ? (2500 - rp) / 1600 : 0, jit = 0.07 + (0.22 * (1 - ld) + 0.1) * idle + 0.1 * (1 - ld);
    let fp = st[FP], amp = st[AMP], cyl = st[CYL] | 0;
    for (let i = 0; i < m; i++) {
      fp += fc; if (fp >= 1) { fp -= 1; cyl = (cyl + 1) & 3; amp = CG[cyl] * (1 + jit * (rnd16() / 32768 - 1)); }
      const tn = fp * ifc; let u = tn * itp, p = 0; if (u < 1) { const v = 1 - u; p = u * u * v * v * v * 28.9; }
      ex[i] = amp * p; ni[i] = wA[i] * (0.25 + p) * amp;
      u = tn * itk; tk[i] = u < 1 ? wB[i] * (1 - u) : 0;
    }
    st[FP] = fp; st[AMP] = amp; st[CYL] = cyl;
    svf(ex, t1, m, 0, 2, 0);                                              // tira o nível contínuo do trem de pulsos
    for (let i = 0; i < m; i++) eg[i] = t1[i] * st[VGS];
    for (let k = 1; k <= 5; k++) { F[3 * k + 2] = st[VGS + k] * (k === 5 ? 0.3 + 0.7 * ld : 1); svf(t1, eg, m, k, 1, 1); }
    F[20] = st[VGS + 6] * ld * (0.25 + 0.75 * ld) * 0.5; svf(ni, eg, m, 6, 1, 1);    // ruído de admissão: só com o pé embaixo
    F[23] = st[VGS + 7] * (0.5 + rp / 6500); svf(tk, eg, m, 7, 2, 1);               // tuchos e válvulas
    // tranco e estalo da troca de marcha
    let clk = st[CLK]; if (clk > 1e-4) { for (let i = 0; i < m; i++) { t2[i] = wB[i] * clk * clk; clk *= 0.9992; } st[CLK] = clk * (clk < 0.02 ? 0 : 1); F[98] = 1.6; svf(t2, eg, m, 32, 1, 1); }
    const drv = 1.4 + 2.6 * ld, ev = (0.3 + 0.7 * Math.pow(ld, 0.8)) * (0.45 + 0.55 * rp / 6500) * dg * 0.4 / (drv / (1 + drv * 0.5));
    for (let i = 0; i < m; i++) { const x = eg[i] * drv; eg[i] = x / (1 + (x < 0 ? -x : x) * 0.5) * ev; }   // saturação: mais harmônicos com carga
    svf(eg, eg, m, 33, 2, 0);
    // ---- pneus: canto (tom instável perto de 1 kHz com harmônicos) + raspado, por lado, na proporção do escorregamento
    for (let s = 0; s < 2; s++) {
      const tgt = ctl[5 + s] * 0.001, a = st[SQ + s] += (tgt - st[SQ + s]) * (tgt > st[SQ + s] ? K20 : K30), o = s ? sR : sL, w = s ? wB : wA;
      if (a < 0.004) { st[SQ + s] = tgt > 0 ? a : 0; o.fill(0); continue; }                                 // agarrou: some de vez
      const j = (st[SQJ + s] += ((rnd16() / 32768 - 1) * 0.08 - st[SQJ + s]) * 0.18) + (st[SQW + s] += ((rnd16() / 32768 - 1) * 2.2 - st[SQW + s]) * 0.004), env = st[SQA + s] += ((rnd16() / 65536) - st[SQA + s]) * 0.05;
      const f = (720 + 380 * a) * (0.86 + 0.22 * (spd < 35 ? spd / 35 : 1)) * (s ? 1.07 : 1) * (1 + j) * dp / sr, g = Math.pow(a, 1.45) * (0.45 + 1.1 * env) * 0.3 * dg, gs = Math.pow(a, 0.8) * 0.55 * dg;
      let ph = st[SQP + s];
      for (let i = 0; i < m; i++) { ph += f; if (ph >= 1) ph -= 1; const q = Math.sin(6.283185307 * ph); t1[i] = (q + 0.4 * (1 - 2 * q * q) + 0.1 * (3 * q - 4 * q * q * q)) * g; t2[i] = w[i] * gs; }
      st[SQP + s] = ph; svf(t2, t1, m, 8 + s, 1, 1); o.set(t1);
    }
    // ---- barramento do carro visto do ouvinte: absorção do ar com a distância
    const air = 15000 / (1 + dist * 0.02); F[90] = F[93] = 2 * Math.sin(PI * (air < sr * 0.16 ? air : sr * 0.16) / sr);
    // ---- vento (velocidade do ouvinte) e rodagem (velocidade do carro)
    const gust = st[GUST] += ((rnd16() / 65536) - st[GUST]) * 0.004, wv = lsp / 42, wg = wv * wv * (0.7 + 0.6 * gust) * (view === 1 ? 0.85 : 0.6), wf = 2 * Math.sin(PI * (260 + 21 * lsp) / sr);
    F[30] = F[33] = wf; F[32] = F[35] = wg;
    svf(wA, L2, m, 10, 1, 0); svf(wB, R2, m, 11, 1, 0);
    const rv = spd / 40; F[36] = 2 * Math.sin(PI * (130 + 9 * spd) / sr); F[38] = Math.pow(rv, 1.3) * 0.5 * dg;
    for (let i = 0; i < m; i++) t1[i] = wA[i] - wB[i]; svf(t1, cb, m, 12, 0, 0);
    const loo = st[LOO] += (ctl[7] * 0.001 - st[LOO]) * K50;
    if (loo > 0.003) { F[41] = loo * 0.5 * dg; svf(wB, cb, m, 13, 1, 1); const dn = 0.004 + 0.02 * loo; for (let i = 0; i < m; i++) t2[i] = (wA[i] > 1 - dn ? 1 : 0) * loo * 3; F[44] = dg; svf(t2, cb, m, 14, 1, 1); }
    const krb = st[KRB] += (ctl[8] * 0.001 - st[KRB]) * K20;
    if (krb > 0.003 || Z[30] > 1e-5 || Z[30] < -1e-5) {
      let kp = st[KPH]; const kf = spd / 0.6 / sr; for (let i = 0; i < m; i++) { kp += kf; if (kp >= 1) { kp -= 1; t2[i] = krb * 7; } else t2[i] = 0; } st[KPH] = kp;
      F[47] = dg; F[50] = dg * 0.5; svf(t2, cb, m, 15, 1, 1); svf(t2, cb, m, 16, 1, 1);
    }
    const hits = ctl[14] | 0; if (hits !== st[HIT]) { st[HIT] = hits; if (st[HITE] < 0.05) st[HITE] = 1; }
    let he = st[HITE]; if (he > 1e-4) { for (let i = 0; i < m; i++) { t2[i] = wA[i] * he * he; he *= 0.9984; } st[HITE] = he < 0.01 ? 0 : he; F[53] = 2.2 * dg; F[56] = 0.7 * dg; svf(t2, cb, m, 17, 0, 1); svf(t2, cb, m, 18, 1, 1); }
    // ---- ambiente: folhagem, cigarras e pássaros (independem do carro)
    const fol = st[FOL] += ((rnd16() / 65536) - st[FOL]) * 0.0015, fg = 0.024 * (0.5 + fol), tm = st[TM] += m, ts = tm / sr;
    F[59] = fg; F[62] = fg; svf(wA, L4, m, 19, 1, 0); svf(wB, R4, m, 20, 1, 0);
    const c1 = Math.sin(ts * 0.48), c2 = Math.sin(ts * 0.37 + 2), a1 = c1 > 0 ? c1 * c1 * 0.07 : 0, a2 = c2 > 0 ? c2 * c2 * 0.055 : 0;
    if (a1 > 1e-5) { for (let i = 0; i < m; i++) { const q = Math.sin(ts * 327 + i * 327 / sr); t1[i] = wA[i] * q * q * a1; } svf(t1, t2, m, 21, 1, 0); for (let i = 0; i < m; i++) { L4[i] += t2[i] * 0.8; R4[i] += t2[i] * 0.3; } }
    if (a2 > 1e-5) { for (let i = 0; i < m; i++) { const q = Math.sin(ts * 270 + i * 270 / sr); t1[i] = wB[i] * q * q * a2; } svf(t1, t2, m, 22, 1, 0); for (let i = 0; i < m; i++) { L4[i] += t2[i] * 0.25; R4[i] += t2[i] * 0.8; } }
    if ((st[NEXT] -= m) <= 0) { st[NEXT] = (0.35 + 2.4 * (rnd16() / 65536)) * sr; birdStart(); }
    for (let v = 0; v < 3; v++) {
      if (BI[v * 2] <= 0) continue;
      const b = BV + v * 10, dur = st[b + 1], f0 = st[b + 2], df = st[b + 3] - f0, vd = st[b + 5], a = st[b + 8], pan = st[b + 9], idur = 1 / dur; let t = st[b], ph = st[b + 6];
      if (t < 0) { t += m; st[b] = t; if (t >= 0) birdNote(v); continue; }                // pausa entre notas
      for (let i = 0; i < m && t < dur; i++, t++) {
        const u = t * idur, e = u < 0.2 ? u * 5 : (1 - u) * 1.25, f = f0 + df * u + (vd ? vd * Math.sin(t * 190 / sr) : 0);
        ph += f / sr; if (ph >= 1) ph -= 1; const q = Math.sin(6.283185307 * ph), y = (q + 0.2 * (1 - 2 * q * q)) * e * e * a * (vd ? 0.6 + 0.4 * Math.sin(t * 190 / sr) : 1);
        L4[i] += y * (1 - pan); R4[i] += y * pan;
      }
      st[b + 6] = ph;
      if (t >= dur) { if (--BI[v * 2] > 0) st[b] = -st[b + 4]; } else st[b] = t;
    }
    // ---- público: murmúrio (ruído em formantes de voz, em ondas lentas) e palmas, só perto da arquibancada
    const crw = st[CRW] += (ctl[12] * 0.001 - st[CRW]) * K200;
    if (crw > 0.004) {
      const cp = st[CPN] += (ctl[13] * 0.001 - st[CPN]) * K200, sw = st[CRE] += ((rnd16() / 65536) - st[CRE]) * 0.003, cg = crw * (0.45 + 1.1 * sw) * (1 + 0.5 * (spd < 40 ? spd / 40 : 1)) * 0.75, gl = cg * (1 - 0.6 * cp) * 0.5, gr = cg * (1 + 0.6 * cp) * 0.5;
      svf(wB, t1, m, 23, 1, 0); svf(wB, t1, m, 24, 1, 1); svf(wB, t1, m, 25, 1, 1); svf(wA, t2, m, 26, 1, 0); svf(wA, t2, m, 27, 1, 1); svf(wA, t2, m, 28, 1, 1);
      for (let i = 0; i < m; i++) { L5[i] = t1[i] * gl; R5[i] = t2[i] * gr; }
      const dn = 0.0035 * (0.4 + sw); for (let i = 0; i < m; i++) t1[i] = wA[i] < -1 + dn ? 9 * (0.3 + wB[i] * wB[i]) : 0;
      svf(t1, t2, m, 29, 1, 0); for (let i = 0; i < m; i++) { L5[i] += t2[i] * gl; R5[i] += t2[i] * gr; }
    } else { L5.fill(0); R5.fill(0); }
    // ---- mistura, absorção do ar no barramento do carro, limitador suave
    const m0 = mix[0], m1 = mix[1], m2 = mix[2], m3 = mix[3], m4 = mix[4] * AMB, m5 = mix[5] * AMB, near = view === 1 ? 1.25 : 1;
    for (let i = 0; i < m; i++) { const e = eg[i] * m0 * near, c = cb[i] * m3; t1[i] = e + c + (sL[i] * 0.85 + sR[i] * 0.4) * m1; t2[i] = e + c + (sL[i] * 0.4 + sR[i] * 0.85) * m1; }
    svf(t1, t1, m, 30, 0, 0); svf(t2, t2, m, 31, 0, 0);
    const dm = (mg1 - mg0) / m;
    for (let i = 0; i < m; i++) {
      const g = mg0 + dm * (i + 1); let l = (t1[i] + L2[i] * m2 + L4[i] * m4 + L5[i] * m5) * g, r = (t2[i] + R2[i] * m2 + R4[i] * m4 + R5[i] * m5) * g;
      let a = l < 0 ? -l : l; if (a > 0.55) { a = 0.55 + (a - 0.55) / (1 + (a - 0.55) / 0.42); l = l < 0 ? -a : a; }
      a = r < 0 ? -r : r; if (a > 0.55) { a = 0.55 + (a - 0.55) / (1 + (a - 0.55) / 0.42); r = r < 0 ? -a : a; }
      oL[i] = l * VOL; oR[i] = r * VOL;
    }
  }
  // escreve n amostras em L e R a partir de off
  function render(L, R, off, n) {
    for (let o = 0; o < n; o += NC) { const m = n - o < NC ? n - o : NC; chunk(m); for (let i = 0; i < m; i++) { L[off + o + i] = oL[i]; R[off + o + i] = oR[i]; } }
  }
  return { ctl, mix, render, reset };
}
// ==== tempo real e fora do tempo real: ligação do sintetizador com o jogo
const SND = { ctx: null, node: null, P: null, ok: false, run: false, mute: false, sc: new Int32Array(16), last: new Int32Array(16), stand: new Float64Array(4), rec: null, recN: 0, pcm: null, an: null, anBuf: null };
function sndInit() {
  SND.stand.fill(0);
}
// Reads simulation and camera state from driver and updates 16 synthesized controls
function sndControl() {
  const d = typeof driver !== 'undefined' ? driver : null;
  if (!d) return;
  const c = SND.sc;
  const sp = Math.abs(d.speed || 0);
  const grass = Math.abs(d.offset || 0) > (typeof TRACK_WIDTH === 'number' ? TRACK_WIDTH * 0.5 : 4.0);
  const kerb = Math.abs(d.offset || 0) > (typeof TRACK_WIDTH === 'number' ? TRACK_WIDTH * 0.5 - 0.7 : 3.3) && !grass;
  const slip = d.slip ? 0.38 : 0;
  const view = typeof camMode === 'number' ? camMode : 0;
  const dist = view === 1 ? 1.0 : view === 0 ? 4.2 : 12.0;

  let throttle = 0.45;
  if (typeof bioProtocol !== 'undefined' && typeof bio !== 'undefined') {
    if (bioProtocol.phase === 'WORK' && bio.contractionLevel >= 0.35) throttle = 1.0;
    else if (d.speed < 22) throttle = 0.85;
    else throttle = 0.35;
  }

  const trackLen = typeof TRACK_LENGTH === 'number' ? TRACK_LENGTH : 860;
  const sPos = ((d.s % trackLen) + trackLen) % trackLen;
  const distToStart = Math.min(sPos, trackLen - sPos);
  const crowdProx = distToStart < 68 ? Math.max(0, 1 - distToStart / 68) : 0;
  let dop = 10000, lsp = sp;
  if (view === 2) {
    const vr = -d.speed * 0.85;
    dop = Math.round((343 / Math.max(10, 343 - vr)) * 10000);
    lsp = 0;
  }

  c[0] = (SND.run ? 1 : 0) | (SND.mute ? 2 : 0) | (view << 2);
  c[1] = Math.round(d.rpm || 950);
  c[2] = Math.round(throttle * 1000);
  c[3] = d.gear < 0 ? 0 : Math.max(1, d.gear || 1);
  c[4] = Math.round(sp * 100);
  c[5] = Math.round(slip * 1000);
  c[6] = Math.round(slip * 1000);
  c[7] = Math.round((grass ? 1 : 0) * (sp < 12 ? sp / 12 : 1) * 1000);
  c[8] = Math.round((kerb ? 1 : 0) * (sp < 12 ? sp / 12 : 1) * 1000);
  c[9] = Math.round(dist * 10);
  c[10] = dop;
  c[11] = Math.round(lsp * 100);
  c[12] = Math.round(crowdProx * 1000);
  c[13] = -450;
  c[14] = 0;
}

function sndStart() {
  if (SND.ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const ctx = SND.ctx = new AC({ latencyHint: 'interactive' });
  const fallback = () => {   // navegador sem AudioWorklet: mesmo sintetizador num ScriptProcessor
    const s = sndCore(ctx.sampleRate), n = SND.node = ctx.createScriptProcessor(1024, 0, 2);
    n.onaudioprocess = e => { const b = e.outputBuffer; for (let k = 0; k < 16; k++) s.ctl[k] = SND.sc[k]; s.render(b.getChannelData(0), b.getChannelData(1), 0, b.length); };
    n.connect(ctx.destination); SND.ok = true;
  };
  if (!ctx.audioWorklet) { fallback(); return; }
  // (o construtor do processador roda ~4 s de áudio com controles variados e zera o estado: o V8 otimiza o sintetizador
  // antes do primeiro bloco de verdade, em vez de passar o primeiro segundo no interpretador, alocando)
  const code = 'const mk=' + sndCore.toString() + ';const N=[];for(let i=0;i<16;i++)N.push("p"+i);registerProcessor("uno",class extends AudioWorkletProcessor{static get parameterDescriptors(){return N.map(n=>({name:n,defaultValue:0,automationRate:"k-rate"}))}constructor(){super();const s=this.s=mk(sampleRate),a=new Float32Array(128),b=new Float32Array(128),c=s.ctl;for(let i=0;i<1600;i++){c[0]=1|(i>>8)%3<<2;c[1]=900+i*37%5600;c[2]=i*13%1001;c[3]=(i>>6)%6;c[4]=i*29%5000;c[5]=i&256?i*7%1000:0;c[6]=i&512?i*11%1000:0;c[7]=i&128?500:0;c[8]=i&64?500:0;c[9]=i*3%900;c[10]=9000+i*17%2000;c[11]=i*29%5000;c[12]=i*5%1000;c[13]=i*19%2000-1000;c[14]=i>>5;s.render(a,b,0,128)}s.reset()}process(i,o,p){const s=this.s,c=s.ctl,q=o[0];for(let k=0;k<16;k++)c[k]=p[N[k]][0];s.render(q[0],q[1],0,q[0].length);return true}})';
  // O módulo vai por URL data: — aberto como arquivo (file://) a página tem origem opaca e o Chrome recusa módulo por URL blob:.
  // Se o navegador recusar data:, tenta blob:; se não houver worklet de jeito nenhum, cai no ScriptProcessor.
  const mod = u => ctx.audioWorklet.addModule(u);
  mod('data:application/javascript;charset=utf-8,' + encodeURIComponent(code)).catch(() => mod(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))).then(() => {
    const n = SND.node = new AudioWorkletNode(ctx, 'uno', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    SND.P = []; for (let i = 0; i < 16; i++) SND.P.push(n.parameters.get('p' + i));
    n.connect(ctx.destination); SND.last.fill(-1); SND.ok = true; sndFlags();
  }).catch(e => { console.warn('AudioWorklet indisponível (' + e.message + '): som pelo ScriptProcessor'); SND.P = null; fallback(); });
}
// envia os controles deste quadro ao sintetizador: só números inteiros pequenos em AudioParams (nada é alocado)
function sndFrame() {
  if (!SND.ok) return; sndControl();
  const P = SND.P; if (!P) return; const c = SND.sc, l = SND.last;
  for (let i = 0; i < 16; i++) { const v = c[i]; if (v !== l[i]) { l[i] = v; P[i].value = v; } }
}
function sndFlags() { const c = SND.sc; c[0] = (SND.run ? 1 : 0) | (SND.mute ? 2 : 0) | (c[0] & 12); if (SND.P) { SND.P[0].value = c[0]; SND.last[0] = c[0]; } }
// pausa (menu) e retomada: o sintetizador some em poucos milissegundos e o contexto de áudio é suspenso em seguida
function sndRun(on) {
  SND.run = on; if (!SND.ctx) return; sndFlags();
  if (on) SND.ctx.resume(); else setTimeout(() => { if (!SND.run && SND.ctx.state === 'running') SND.ctx.suspend(); }, 150);
}
function sndMute(m) { SND.mute = m; sndFlags(); }
// gravação dos controles a cada quadro de 1/60 s (captura): a trilha do vídeo sai da mesma simulação que os quadros
function sndRecTick() { const r = SND.rec; if (SND.recN * 16 >= r.length) return; const was = SND.run; SND.run = true; sndControl(); SND.run = was; r.set(SND.sc, SND.recN++ * 16); }
// Síntese fora do tempo real dos controles gravados → PCM estéreo de 16 bits a 48 kHz (800 amostras por quadro de 1/60 s).
// mix: bits das camadas (63 = todas); mudoDe / pausaDe: quadro a partir do qual liga o mudo / a pausa (-1 = nunca).
function sndOffline(mix, mudoDe, pausaDe) {
  const n = SND.recN, S = sndCore(48000), L = new Float32Array(n * 800), Rr = new Float32Array(n * 800), pcm = SND.pcm = new Int16Array(n * 1600), rec = SND.rec;
  for (let i = 0; i < 6; i++) S.mix[i] = (mix >> i) & 1;
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < 16; k++) S.ctl[k] = rec[f * 16 + k];
    if (mudoDe >= 0 && f >= mudoDe) S.ctl[0] = rec[f * 16] | 2; if (pausaDe >= 0 && f >= pausaDe) S.ctl[0] = rec[f * 16] & ~1;
    S.render(L, Rr, f * 800, 800);
  }
  let pk = 0; for (let i = 0; i < n * 800; i++) { const a = Math.abs(L[i]), b = Math.abs(Rr[i]); if (a > pk) pk = a; if (b > pk) pk = b; pcm[i * 2] = Math.round(L[i] * 32767); pcm[i * 2 + 1] = Math.round(Rr[i] * 32767); }
  return { quadros: n, amostras: n * 800, taxa: 48000, pico: pk };
}
