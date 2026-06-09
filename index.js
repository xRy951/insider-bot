require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const xml2js = require("xml2js");
const fs = require("fs");

require("./server.js");

// ============================================================
//  CONFIG — fill these in before running
// ============================================================
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  buyChannelId: process.env.BUY_CHANNEL_ID,
  sellChannelId: process.env.SELL_CHANNEL_ID,

  // How often to poll SEC EDGAR for new filings (ms). 60000 = 1 minute.
  // With 500 companies, recommend 5 minutes to avoid rate limiting.
  pollIntervalMs: 300_000,

  // Minimum dollar value to alert on (0 = alert on everything)
  // Recommended: 100000 to filter out tiny trades across 500 companies
  minValueUsd: 100_000,
};
// ============================================================

// Full S&P 500 ticker list — CIKs are resolved automatically on startup
const SP500_TICKERS = [
  "MMM","AOS","ABT","ABBV","ACN","ADBE","AMD","AES","AFL","A","APD","ABNB",
  "AKAM","ALB","ARE","ALGN","ALLE","LNT","ALL","GOOGL","GOOG","MO","AMZN",
  "AMCR","AEE","AAL","AEP","AXP","AIG","AMT","AWK","AMP","AME","AMGN","APH",
  "ADI","ANSS","AON","APA","AAPL","AMAT","APTV","ACGL","ADM","ANET","AJG",
  "AIZ","T","ATO","ADSK","ADP","AZO","AVB","AVY","AXON","BKR","BALL","BAC",
  "BBWI","BAX","BDX","BRK.B","BBY","BIO","TECH","BIIB","BLK","BX","BA","BCR",
  "BMY","AVGO","BR","BRO","BF.B","BLDR","BSX","BWA","BXP","CHRW","CDNS","CZR",
  "CPT","CPB","COF","CAH","KMX","CCL","CARR","CTLT","CAT","CBOE","CBRE","CDW",
  "CE","COR","CNC","CNX","CDAY","CF","CRL","SCHW","CHTR","CVX","CMG","CB",
  "CHD","CI","CINF","CTAS","CSCO","C","CFG","CLX","CME","CMS","KO","CTSH",
  "CL","CMCSA","CMA","CAG","COP","ED","STZ","CEG","COO","CPRT","GLW","CTVA",
  "CSGP","COST","CTRA","CCI","CSX","CMI","CVS","DHI","DHR","DRI","DVA","DAY",
  "DECK","DE","DAL","DVN","DXCM","FANG","DLR","DFS","DG","DLTR","D","DPZ",
  "DOV","DOW","DHC","DTE","DUK","DD","EMN","ETN","EBAY","ECL","EIX","EW","EA",
  "ELV","LLY","EMR","ENPH","ETR","EOG","EPAM","EQT","EFX","EQIX","EQR","ESS",
  "EL","ETSY","EG","EVRG","ES","EXC","EXPE","EXPD","EXR","XOM","FFIV","FDS",
  "FICO","FAST","FRT","FDX","FIS","FITB","FSLR","FE","FI","FLT","FMC","F",
  "FTNT","FTV","FOXA","FOX","BEN","FCX","GRMN","IT","GE","GEHC","GEV","GEN",
  "GNRC","GD","GIS","GM","GPC","GILD","GPN","GL","GDDY","GS","HAL","HIG",
  "HAS","HCA","DOC","HSIC","HSY","HES","HPE","HLT","HOLX","HD","HON","HRL",
  "HST","HWM","HPQ","HUBB","HUM","HBAN","HII","IBM","IEX","IDXX","ITW","INCY",
  "IR","PODD","INTC","ICE","IFF","IP","IPG","INTU","ISRG","IVZ","INVH","IQV",
  "IRM","JBHT","JBL","JKHY","J","JNJ","JCI","JPM","JNPR","K","KVUE","KDP",
  "KEY","KEYS","KMB","KIM","KMI","KLAC","KHC","KR","LHX","LH","LRCX","LW",
  "LVS","LDOS","LEN","LIN","LYV","LKQ","LMT","L","LOW","LULU","LYB","MTB",
  "MRO","MPC","MKTX","MAR","MMC","MLM","MAS","MA","MTCH","MKC","MCD","MCK",
  "MDT","MRK","META","MET","MTD","MGM","MCHP","MU","MSFT","MAA","MRNA","MHK",
  "MOH","TAP","MDLZ","MPWR","MNST","MCO","MS","MOS","MSI","MSCI","NDAQ","NTAP",
  "NFLX","NEM","NWSA","NWS","NEE","NKE","NI","NDSN","NSC","NTRS","NOC","NCLH",
  "NRG","NUE","NVDA","NVR","NXPI","ORLY","OXY","ODFL","OMC","ON","OKE","ORCL",
  "OTIS","PCAR","PKG","PANW","PH","PAYX","PAYC","PYPL","PNR","PEP","PFE","PCG",
  "PM","PSX","PNW","PXD","PNC","POOL","PPG","PPL","PFG","PG","PGR","PLD","PRU",
  "PEG","PTCT","PTC","PSA","PHM","QRVO","PWR","QCOM","DGX","RL","RJF","RTX",
  "O","REG","REGN","RF","RSG","RMD","RVTY","ROK","ROL","ROP","ROST","RCL",
  "SPGI","CRM","SBAC","SLB","STX","SRE","NOW","SHW","SPG","SWKS","SJM","SNA",
  "SOLV","SO","LUV","SWK","SBUX","STT","STLD","STE","SYK","SYF","SNPS","SYY",
  "TMUS","TROW","TTWO","TPR","TRGP","TGT","TEL","TDY","TFX","TER","TSLA","TXN",
  "TXT","TMO","TJX","TSCO","TT","TDG","TRV","TRMB","TFC","TYL","TSN","USB",
  "UBER","UDR","ULTA","UNP","UAL","UPS","URI","UNH","UHS","VLO","VTR","VRSN",
  "VRSK","VZ","VRTX","VTRS","VLTO","VMC","WRB","WAB","WBA","WMT","WBD","WM",
  "WAT","WEC","WFC","WELL","WST","WDC","WRK","WY","WHR","WMB","WTW","GWW",
  "WYNN","XEL","XYL","YUM","ZBRA","ZBH","ZTS"
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Persist seen filing accession numbers so we don't double-post
const SEEN_FILE = "./seen_filings.json";
const CIK_CACHE_FILE = "./cik_cache.json";
let seenFilings = new Set();
let watchList = []; // populated on startup by resolveCIKs()

function loadSeen() {
  try {
    if (fs.existsSync(SEEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"));
      seenFilings = new Set(data);
    }
  } catch { /* ignore */ }
}

function saveSeen() {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenFilings]));
}

// ── CIK resolution ────────────────────────────────────────────

/** Look up a ticker's CIK from SEC EDGAR company search */
async function lookupCIK(ticker) {
  const url = `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&dateRange=custom&startdt=2020-01-01&enddt=2026-12-31&forms=4`;
  try {
    const res = await axios.get(
      `https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=${ticker}&type=4&dateb=&owner=include&count=1&search_text=&action=getcompany&output=atom`,
      { headers: { "User-Agent": "InsiderBot contact@example.com" }, timeout: 8_000 }
    );
    const match = res.data.match(/\/cgi-bin\/browse-edgar\?action=getcompany&CIK=(\d+)/);
    if (match) return match[1];
  } catch { /* ignore */ }
  return null;
}

/** Load CIK cache or resolve all tickers from SEC EDGAR */
async function resolveCIKs() {
  let cache = {};
  if (fs.existsSync(CIK_CACHE_FILE)) {
    try { cache = JSON.parse(fs.readFileSync(CIK_CACHE_FILE, "utf8")); } catch { /* ignore */ }
  }

  const missing = SP500_TICKERS.filter(t => !cache[t]);
  if (missing.length > 0) {
    console.log(`🔍 Resolving CIKs for ${missing.length} tickers from SEC EDGAR...`);
    let resolved = 0;
    for (const ticker of missing) {
      const cik = await lookupCIK(ticker);
      if (cik) {
        cache[ticker] = cik;
        resolved++;
      }
      // Be polite to SEC servers — small delay between requests
      await new Promise(r => setTimeout(r, 300));
    }
    fs.writeFileSync(CIK_CACHE_FILE, JSON.stringify(cache, null, 2));
    console.log(`✅ Resolved ${resolved}/${missing.length} new CIKs. Cache saved.`);
  } else {
    console.log(`✅ CIK cache loaded for ${Object.keys(cache).length} tickers.`);
  }

  // Build watchList from cache
  watchList = Object.entries(cache)
    .filter(([, cik]) => cik)
    .map(([ticker, cik]) => ({ ticker, cik }));

  console.log(`📋 Watching ${watchList.length} S&P 500 companies.`);
}

// ── SEC EDGAR helpers ─────────────────────────────────────────

async function fetchRecentFilings(cik) {
  const paddedCik = cik.padStart(10, "0");
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=4&dateb=&owner=include&count=5&search_text=&output=atom`;
  const res = await axios.get(url, {
    headers: { "User-Agent": "InsiderBot contact@example.com" },
    timeout: 10_000,
  });
  const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false });
  const entries = parsed?.feed?.entry;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
}

async function parseForm4(indexUrl) {
  const indexRes = await axios.get(indexUrl, {
    headers: { "User-Agent": "InsiderBot contact@example.com" },
    timeout: 10_000,
  });
  const xmlMatch = indexRes.data.match(/href="([^"]*form4[^"]*\.xml)"/i);
  if (!xmlMatch) return null;

  const xmlUrl = xmlMatch[1].startsWith("http")
    ? xmlMatch[1]
    : `https://www.sec.gov${xmlMatch[1]}`;

  const xmlRes = await axios.get(xmlUrl, {
    headers: { "User-Agent": "InsiderBot contact@example.com" },
    timeout: 10_000,
  });
  return xml2js.parseStringPromise(xmlRes.data, { explicitArray: false });
}

// ── Embed builder ─────────────────────────────────────────────

function buildEmbed(data, ticker, filingUrl) {
  const doc = data?.ownershipDocument;
  if (!doc) return null;

  const reportingOwner = doc.reportingOwner;
  const ownerName = reportingOwner?.reportingOwnerId?.rptOwnerName ?? "Unknown";
  const relationship = reportingOwner?.reportingOwnerRelationship ?? {};
  const title =
    relationship.officerTitle ??
    (relationship.isDirector === "1" ? "Director" : null) ??
    (relationship.isTenPercentOwner === "1" ? "10% Owner" : "Insider");

  const issuer = doc.issuer;
  const companyName = issuer?.issuerName ?? ticker;
  const filingDate = doc.periodOfReport ?? "N/A";

  const rawTxns = doc.nonDerivativeTable?.nonDerivativeTransaction;
  const transactions = rawTxns
    ? Array.isArray(rawTxns) ? rawTxns : [rawTxns]
    : [];

  if (transactions.length === 0) return null;

  const buys = transactions.filter(
    (t) => t.transactionAmounts?.transactionAcquiredDisposedCode?.value === "A"
  );
  const sells = transactions.filter(
    (t) => t.transactionAmounts?.transactionAcquiredDisposedCode?.value === "D"
  );

  const results = [];

  for (const [group, isBuy] of [[buys, true], [sells, false]]) {
    if (group.length === 0) continue;

    const totalShares = group.reduce((sum, t) => {
      return sum + parseFloat(t.transactionAmounts?.transactionShares?.value ?? 0);
    }, 0);

    if (totalShares === 0) continue;

    const avgPrice =
      group.reduce((sum, t) => {
        return sum + parseFloat(t.transactionAmounts?.transactionPricePerShare?.value ?? 0);
      }, 0) / group.length;

    const totalValue = totalShares * avgPrice;

    if (CONFIG.minValueUsd > 0 && totalValue < CONFIG.minValueUsd) continue;

    const color = isBuy ? 0x00c853 : 0xff1744;
    const arrow = isBuy ? "▲" : "▼";
    const action = isBuy ? "BUY" : "SELL";
    const planLabel = "10b5-1";

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${arrow} INSIDER ${action} · ${planLabel} — $${ticker}`)
      .setDescription(
        `**${ownerName}**, ${title} of **${companyName}** has disclosed an insider **${action.toLowerCase()}** of **${totalShares.toLocaleString()} shares**. The filing was posted on **${filingDate}**.`
      )
      .addFields(
        { name: "Avg Price", value: `$${avgPrice.toFixed(2)}`, inline: true },
        { name: "Total Value", value: `$${(totalValue / 1_000_000).toFixed(2)}M`, inline: true }
      )
      .setFooter({ text: `SEC Form 4 · ${planLabel} Plan · Filed ${new Date().toLocaleString()}` });

    if (group.length > 0) {
      const breakdown = group
        .map((t, i) => {
          const shares = parseFloat(t.transactionAmounts?.transactionShares?.value ?? 0).toLocaleString();
          const price = parseFloat(t.transactionAmounts?.transactionPricePerShare?.value ?? 0).toFixed(2);
          return `${i + 1}. ${shares} shares @ $${price}`;
        })
        .join("\n");
      embed.addFields({ name: `Breakdown (${group.length} trade${group.length > 1 ? "s" : ""})`, value: breakdown });
    }

    embed.addFields({ name: "View SEC Filing", value: `[Filing Link](${filingUrl})` });
    results.push({ embed, isBuy });
  }

  return results;
}

// ── Polling loop ──────────────────────────────────────────────

async function checkFilings() {
  const buyChannel = client.channels.cache.get(CONFIG.buyChannelId);
  const sellChannel = client.channels.cache.get(CONFIG.sellChannelId);

  if (!buyChannel || !sellChannel) {
    console.error("❌ Channel(s) not found. Check your environment variables.");
    return;
  }

  console.log(`🔄 Checking filings for ${watchList.length} companies...`);

  for (const { ticker, cik } of watchList) {
    try {
      const entries = await fetchRecentFilings(cik);

      for (const entry of entries) {
        const accession = entry?.id ?? entry?.["filing-href"] ?? "";
        const filingHref = entry?.["filing-href"] ?? entry?.link?.["$"]?.href ?? accession;

        if (!accession || seenFilings.has(accession)) continue;
        seenFilings.add(accession);
        saveSeen();

        try {
          const form4Data = await parseForm4(filingHref);
          if (!form4Data) continue;

          const results = buildEmbed(form4Data, ticker, filingHref);
          if (!results || results.length === 0) continue;

          for (const { embed, isBuy } of results) {
            const channel = isBuy ? buyChannel : sellChannel;
            await channel.send({ embeds: [embed] });
          }

          console.log(`✅ Posted filing for $${ticker}`);
        } catch (err) {
          console.error(`⚠️  Error parsing filing ${ticker}:`, err.message);
        }
      }

      // Small delay between companies to respect SEC rate limits
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`⚠️  Error fetching filings for ${ticker}:`, err.message);
    }
  }
}

// ── Bot startup ───────────────────────────────────────────────

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  loadSeen();
  await resolveCIKs(); // resolve all S&P 500 CIKs on startup
  checkFilings();
  setInterval(checkFilings, CONFIG.pollIntervalMs);
  console.log(`🔄 Polling every ${CONFIG.pollIntervalMs / 1000}s`);
});

client.login(CONFIG.token);