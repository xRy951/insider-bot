const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
require("dotenv").config();
const axios = require("axios");
const xml2js = require("xml2js");
const fs = require("fs");

require("./server.js");

// ============================================================
//  CONFIG — fill these in before running
// ============================================================
const CONFIG = {
token: process.env.DISCORD_TOKEN,      // Discord bot token
  buyChannelId: "1513963746752598016",   // #insider-buys channel ID
  sellChannelId: "1513963762325917847", // #insider-sells channel ID

  // How often to poll SEC EDGAR for new filings (ms). 60000 = 1 minute.
  pollIntervalMs: 60_000,

  // Only alert on filings for these tickers/CIK numbers.
  // Leave empty [] to receive ALL Form 4 filings (very noisy!).
  // Example: [{ ticker: "KO", cik: "21344" }, { ticker: "AAPL", cik: "320193" }]
  watchList: [
    { ticker: "KO", cik: "21344" },
  ],

  // Minimum dollar value to alert on (0 = alert on everything)
  minValueUsd: 0,
};
// ============================================================

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Persist seen filing accession numbers so we don't double-post
const SEEN_FILE = "./seen_filings.json";
let seenFilings = new Set();

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

// ── SEC EDGAR helpers ─────────────────────────────────────────

/** Fetch recent Form 4 filings for a CIK from the EDGAR RSS feed */
async function fetchRecentFilings(cik) {
  const paddedCik = cik.padStart(10, "0");
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=4&dateb=&owner=include&count=10&search_text=&output=atom`;
  const res = await axios.get(url, {
    headers: { "User-Agent": "InsiderBot contact@example.com" },
    timeout: 10_000,
  });
  const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false });
  const entries = parsed?.feed?.entry;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
}

/** Download and parse the form4.xml from a filing index URL */
async function parseForm4(indexUrl) {
  // Fetch the index page to find form4.xml
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

  // Collect all non-derivative transactions
  const rawTxns = doc.nonDerivativeTable?.nonDerivativeTransaction;
  const transactions = rawTxns
    ? Array.isArray(rawTxns) ? rawTxns : [rawTxns]
    : [];

  if (transactions.length === 0) return null;

  // Separate buys (A = acquire) and sells (D = dispose)
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

    // Skip if below minimum threshold
    if (CONFIG.minValueUsd > 0 && totalValue < CONFIG.minValueUsd) continue;

    const planCode = group[0]?.transactionCoding?.transactionCode ?? "";
    const is10b5 = planCode === "J" || group[0]?.transactionCoding?.equitySwapInvolved === "1"
      ? false
      : true; // Most Form 4 open-market trades; label 10b5-1 if footnotes mention it

    const color = isBuy ? 0x00c853 : 0xff1744; // green / red
    const arrow = isBuy ? "▲" : "▼";
    const action = isBuy ? "BUY" : "SELL";
    const planLabel = "10b5-1"; // Form 4 filings frequently involve 10b5-1 plans

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${arrow} INSIDER ${action} · ${planLabel} — $${ticker}`)
      .setDescription(
        `**${ownerName}**, ${title} of **${companyName}** has disclosed an insider **${action.toLowerCase()}** of **${totalShares.toLocaleString()} shares**. The filing was posted on **${filingDate}**.`
      )
      .addFields(
        {
          name: "Avg Price",
          value: `$${avgPrice.toFixed(2)}`,
          inline: true,
        },
        {
          name: "Total Value",
          value: `$${(totalValue / 1_000_000).toFixed(2)}M`,
          inline: true,
        }
      )
      .setFooter({
        text: `SEC Form 4 · ${planLabel} Plan · Filed ${new Date().toLocaleString()}`,
      });

    // Breakdown
    if (group.length > 0) {
      const breakdown = group
        .map((t, i) => {
          const shares = parseFloat(
            t.transactionAmounts?.transactionShares?.value ?? 0
          ).toLocaleString();
          const price = parseFloat(
            t.transactionAmounts?.transactionPricePerShare?.value ?? 0
          ).toFixed(2);
          return `${i + 1}. ${shares} shares @ $${price}`;
        })
        .join("\n");

      embed.addFields({
        name: `Breakdown (${group.length} trade${group.length > 1 ? "s" : ""})`,
        value: breakdown,
      });
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

  if (!buyChannel) {
    console.error("❌ Buy channel not found. Check CONFIG.buyChannelId.");
    return;
  }
  if (!sellChannel) {
    console.error("❌ Sell channel not found. Check CONFIG.sellChannelId.");
    return;
  }

  for (const { ticker, cik } of CONFIG.watchList) {
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

          console.log(`✅ Posted filing for $${ticker}: ${accession}`);
        } catch (err) {
          console.error(`⚠️  Error parsing filing ${accession}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`⚠️  Error fetching filings for ${ticker}:`, err.message);
    }
  }
}

// ── Bot startup ───────────────────────────────────────────────

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  loadSeen();
  checkFilings(); // run immediately on startup
  setInterval(checkFilings, CONFIG.pollIntervalMs);
  console.log(`🔄 Polling every ${CONFIG.pollIntervalMs / 1000}s`);
});

client.login(CONFIG.token);