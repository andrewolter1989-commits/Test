const state = {
  rates: [],
  zones: [],
  floater: {},
  ancillary: {},
  emails: {},
  initialized: false
};

const els = {
  form: document.getElementById("calculatorForm"),
  postalCode: document.getElementById("postalCode"),
  slots: document.getElementById("slots"),
  pallets: document.getElementById("pallets"),
  bookingWindow: document.getElementById("bookingWindow"),
  bookingDate: document.getElementById("bookingDate"),
  fatalError: document.getElementById("fatalError"),
  summaryBox: document.getElementById("summaryBox"),
  summaryPostal: document.getElementById("summaryPostal"),
  summarySlots: document.getElementById("summarySlots"),
  summaryPallets: document.getElementById("summaryPallets"),
  summaryTransport: document.getElementById("summaryTransport"),
  summaryBookingWindow: document.getElementById("summaryBookingWindow"),
  summaryBookingDate: document.getElementById("summaryBookingDate"),
  summaryCount: document.getElementById("summaryCount"),
  summaryBest: document.getElementById("summaryBest"),
  resultsSection: document.getElementById("resultsSection"),
  resultsBody: document.getElementById("resultsBody"),
  transportOptions: Array.from(document.querySelectorAll(".transport-option")),
  transportInputs: Array.from(document.querySelectorAll('input[name="transportType"]'))
};

document.addEventListener("DOMContentLoaded", () => {
  setupTransportToggle();
  els.slots.addEventListener("input", syncDerivedFieldsFromSlots);
  syncDerivedFieldsFromSlots();

  loadAllData().then(() => {
    state.initialized = true;
  }).catch((error) => {
    showFatal(`Dateien konnten nicht geladen werden: ${error.message}`);
  });

  els.form.addEventListener("submit", onSubmit);
  els.form.addEventListener("reset", onReset);
});

function setupTransportToggle() {
  els.transportInputs.forEach((input) => {
    input.addEventListener("change", () => {
      els.transportOptions.forEach((option) => {
        option.classList.toggle("active", option.querySelector("input").checked);
      });

      if (getTransportType() === "FTL") {
        els.slots.value = "34";
        if (!els.pallets.value || Number(els.pallets.value) === 1 || Number(els.pallets.value) === Number(els.slots.dataset.lastAutoValue || 1)) {
          els.pallets.value = "34";
        }
      }
      syncDerivedFieldsFromSlots();
    });
  });
}

function syncDerivedFieldsFromSlots() {
  const slots = Number(els.slots.value);
  const pallets = calculatePalletsFromSlots(slots);
  els.slots.dataset.lastAutoValue = Number.isFinite(pallets) ? String(pallets) : "";
  if (!els.pallets.matches(":focus") && (els.pallets.value === "" || els.pallets.value === "1" || els.pallets.value === els.pallets.dataset.lastAutoValueOld || Number(els.pallets.value) === Number(els.slots.dataset.previousAutoValue || 1))) {
    els.pallets.value = Number.isFinite(pallets) ? String(pallets) : "";
  }
  els.pallets.dataset.lastAutoValueOld = Number.isFinite(pallets) ? String(pallets) : "";
  els.slots.dataset.previousAutoValue = Number.isFinite(pallets) ? String(pallets) : "";
}

async function loadAllData() {
  const [ratesText, zonesText, floater, ancillary, emails] = await Promise.all([
    fetchText("rates.csv"),
    fetchText("zones.csv"),
    fetchJson("floater.json", {}),
    fetchJson("ancillary.json", {}),
    fetchJson("emails.json", {})
  ]);

  state.rates = parseRatesCsv(ratesText);
  state.zones = parseZonesCsv(zonesText);
  state.floater = normalizeFloater(floater);
  state.ancillary = normalizeAncillary(ancillary);
  state.emails = emails || {};
}

async function fetchText(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} (${response.status})`);
  return await response.text();
}

async function fetchJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

function parseSemicolonCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(line => line.trim() !== "");
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? "").trim();
    });
    return row;
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ';' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseRatesCsv(text) {
  return parseSemicolonCsv(text).map((row) => {
    const zonePrices = {};
    Object.keys(row).forEach((key) => {
      const match = key.match(/^Zone\s+(\d+)$/i);
      if (match) zonePrices[match[1]] = parseGermanNumber(row[key]);
    });
    return {
      forwarder: (row["Forwarder"] || "").trim(),
      chgFrom: parseGermanNumber(row["CHG from"]),
      chgTo: parseGermanNumber(row["CHG to"]),
      unit: ((row["Unit"] || "").trim().toUpperCase()),
      zonePrices
    };
  }).filter(row => row.forwarder);
}

function parseZonesCsv(text) {
  return parseSemicolonCsv(text).map((row) => ({
    forwarder: (row["Forwarder"] || "").trim(),
    destFromRaw: (row["Dest From"] || "").trim(),
    destToRaw: (row["Dest To"] || "").trim(),
    zone: String(row["Zone"] || "").trim()
  })).filter(row => row.zone);
}

function normalizeFloater(input) {
  const result = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    const parsed = parseGermanNumber(value);
    result[normalizeName(key)] = parsed > 1 ? parsed / 100 : parsed;
  });
  return result;
}

function normalizeAncillary(input) {
  const result = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeName(key);
    result[normalizedKey] = {
      enabled: Boolean(value?.enabled ?? true),
      mode: String(value?.mode || "per_psp"),
      value: parseGermanNumber(value?.value ?? 0)
    };
  });
  return result;
}

function parseGermanNumber(value) {
  if (typeof value === "number") return value;
  const normalized = String(value ?? "").trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePostalCode(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
}

function formatMoney(value) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value || 0);
}

function formatPercent(value) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format((value || 0) * 100) + " %";
}

function formatDisplayDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

function getTransportType() {
  return els.transportInputs.find(input => input.checked)?.value || "Teilladung";
}

function showFatal(text) {
  els.fatalError.textContent = text;
  els.fatalError.style.display = "block";
}

function clearFatal() {
  els.fatalError.style.display = "none";
  els.fatalError.textContent = "";
}

function onReset() {
  setTimeout(() => {
    clearFatal();
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    els.resultsBody.innerHTML = `<tr><td colspan="8" class="muted">Noch keine Berechnung.</td></tr>`;
    els.transportInputs.forEach(input => { input.checked = input.value === "Teilladung"; });
    els.transportOptions.forEach(option => { option.classList.toggle("active", option.querySelector("input").checked); });
    els.slots.value = "1";
    els.pallets.value = "1";
    els.bookingWindow.value = "";
    els.bookingDate.value = "";
    syncDerivedFieldsFromSlots();
  }, 0);
}

async function onSubmit(event) {
  event.preventDefault();
  if (!state.initialized) return;

  clearFatal();

  const postalCodeRaw = els.postalCode.value.trim();
  const postalCode = normalizePostalCode(postalCodeRaw);
  const slots = Number(els.slots.value);
  const pallets = Number(els.pallets.value);
  const transportType = getTransportType();
  const bookingWindow = els.bookingWindow.value.trim();
  const bookingDate = els.bookingDate.value;

  if (!postalCode) return;
  if (!Number.isFinite(slots) || slots <= 0) return;
  if (!Number.isFinite(pallets) || pallets <= 0) return;

  const calculations = calculateAll(postalCode, slots, pallets);
  if (!calculations.results.length) {
    const zoneExistsAnywhere = state.zones.some(z => zoneMatchesPostal(z, postalCode));
    const reason = zoneExistsAnywhere
      ? `Für die PLZ ${postalCodeRaw} wurde kein passender Tarif gefunden.`
      : `Keine Zone gefunden. Für die PLZ ${postalCodeRaw} liegt aktuell keine Zuordnung vor.`;
    showFatal(reason);
    els.summaryBox.style.display = "none";
    els.resultsSection.style.display = "none";
    return;
  }

  renderSummary({
    postalCode: postalCodeRaw,
    slots,
    pallets,
    transportType,
    bookingWindow,
    bookingDate,
    resultCount: calculations.results.length,
    best: calculations.results[0]
  });

  renderResults(calculations.results);
}

function calculateAll(postalCode, slots, pallets) {
  const allForwarders = [...new Set(state.rates.map(row => row.forwarder))];
  const results = [];
  let missingCount = 0;

  allForwarders.forEach((forwarder) => {
    const zoneInfo = findZoneForForwarder(forwarder, postalCode);
    if (!zoneInfo) {
      missingCount++;
      return;
    }

    const matchingRates = state.rates.filter((row) =>
      normalizeName(row.forwarder) === normalizeName(forwarder) &&
      slots >= row.chgFrom &&
      slots <= row.chgTo
    );

    if (!matchingRates.length) {
      missingCount++;
      return;
    }

    const viable = [];
    matchingRates.forEach((rate) => {
      const rawZonePrice = rate.zonePrices[zoneInfo.zone];
      if (!Number.isFinite(rawZonePrice) || rawZonePrice >= 90000) return;

      let basePrice = rawZonePrice;
      if (rate.unit === "PLL") {
        basePrice = rawZonePrice * slots;
      } else if (rate.unit === "SHP") {
        basePrice = rawZonePrice;
      }

      const floaterRate = state.floater[normalizeName(forwarder)] || 0;
      const floaterEuro = basePrice * floaterRate;
      const ancillaryCharge = calculateAncillary(forwarder, pallets);
      const totalPrice = basePrice + floaterEuro + ancillaryCharge;

      viable.push({
        forwarder,
        zone: zoneInfo.zone,
        basePrice,
        floaterRate,
        floaterEuro,
        ancillaryCharge,
        totalPrice
      });
    });

    if (!viable.length) {
      missingCount++;
      return;
    }

    viable.sort((a, b) => a.totalPrice - b.totalPrice);
    results.push(viable[0]);
  });

  results.sort((a, b) => a.totalPrice - b.totalPrice);
  return { results, missingCount };
}

function calculateAncillary(forwarder, pallets) {
  const entry = state.ancillary[normalizeName(forwarder)];
  if (!entry || entry.enabled === false) return 0;
  if (entry.mode === "fixed") return entry.value;
  if (entry.mode === "per_psp" || entry.mode === "per_palette") return entry.value * pallets;
  return 0;
}

function calculatePalletsFromSlots(slots) {
  if (!Number.isFinite(slots) || slots <= 0) return NaN;
  return Math.ceil(slots);
}

function findZoneForForwarder(forwarder, postalCode) {
  const specific = state.zones.find((row) =>
    normalizeName(row.forwarder) === normalizeName(forwarder) &&
    zoneMatchesPostal(row, postalCode)
  );
  if (specific) return specific;
  return state.zones.find((row) =>
    normalizeName(row.forwarder) === "all" &&
    zoneMatchesPostal(row, postalCode)
  ) || null;
}

function zoneMatchesPostal(zoneRow, postalCode) {
  const input = normalizePostalCode(postalCode);
  const from = normalizePostalCode(zoneRow.destFromRaw);
  const to = normalizePostalCode(zoneRow.destToRaw);
  if (!input || !from || !to) return false;

  const inputNum = Number(input);
  const fromNum = Number(from);
  const toNum = Number(to);
  if ([inputNum, fromNum, toNum].every(Number.isFinite)) {
    return inputNum >= fromNum && inputNum <= toNum;
  }
  return input >= from && input <= to;
}

function renderSummary({ postalCode, slots, pallets, transportType, bookingWindow, bookingDate, resultCount, best }) {
  els.summaryPostal.textContent = postalCode;
  els.summarySlots.textContent = new Intl.NumberFormat("de-DE").format(slots);
  els.summaryPallets.textContent = new Intl.NumberFormat("de-DE").format(pallets);
  els.summaryTransport.textContent = transportType;
  els.summaryBookingWindow.textContent = bookingWindow || "—";
  els.summaryBookingDate.textContent = formatDisplayDate(bookingDate);
  els.summaryCount.textContent = new Intl.NumberFormat("de-DE").format(resultCount);
  els.summaryBest.textContent = `${best.forwarder} (${formatMoney(best.totalPrice)})`;
  els.summaryBox.style.display = "grid";
}

function renderResults(results) {
  els.resultsSection.style.display = "block";
  els.resultsBody.innerHTML = "";
  results.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (index === 0) tr.className = "best-row";

    const providerCell = index === 0
      ? `<span class="badge">Günstigster</span><span class="provider-name">${escapeHtml(row.forwarder)}</span>`
      : `<span class="provider-name">${escapeHtml(row.forwarder)}</span>`;

    const emailAddress = state.emails[row.forwarder] || "";
    const emailButton = `<button type="button" class="email-btn ${emailAddress ? "" : "secondary"}" onclick="createEmailRequest('${escapeJs(row.forwarder)}')">${emailAddress ? "E-Mail-Anfrage erstellen" : "E-Mail fehlt"}</button>`;

    tr.innerHTML = `
      <td>${providerCell}</td>
      <td>${escapeHtml(row.zone)}</td>
      <td class="right">${formatMoney(row.basePrice)}</td>
      <td class="right">${formatPercent(row.floaterRate)}</td>
      <td class="right">${formatMoney(row.floaterEuro)}</td>
      <td class="right">${formatMoney(row.ancillaryCharge)}</td>
      <td class="right total-price">${formatMoney(row.totalPrice)}</td>
      <td>${emailButton}</td>
    `;
    els.resultsBody.appendChild(tr);
  });
}

function createEmailRequest(forwarder) {
  const to = state.emails[forwarder] || "";
  if (!to) {
    alert(`Für ${forwarder} ist noch keine E-Mail-Adresse in emails.json hinterlegt.`);
    return;
  }

  const plz = els.postalCode.value.trim();
  const slots = els.slots.value.trim();
  const pallets = els.pallets.value.trim();
  const bookingWindow = els.bookingWindow.value.trim();
  const bookingDate = formatDisplayDate(els.bookingDate.value);
  const transportType = getTransportType();

  const subject = encodeURIComponent(`Fahrzeuganfrage PLZ ${plz}`);
  const body = encodeURIComponent(
`Moin ${forwarder},

ich benötige für folgende Relation ein Fahrzeug:

PLZ: ${plz}
Stellplätze: ${slots}
Paletten: ${pallets}
Transportart: ${transportType}
Zeitfenster Buchung: ${bookingWindow || "-"}
Termin: ${bookingDate || "-"}

Vielen Dank.`
  );

  window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJs(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
