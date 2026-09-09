const firebaseConfig = {
  apiKey: "AIzaSyDG_-Nm1TxSdOSTJvXD7xPGtRG6k6aUp2k",
  authDomain: "taosensoresp32.firebaseapp.com",
  databaseURL: "https://taosensoresp32-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "taosensoresp32"
};


const SENSOR_PATH = "Sensor";
const CONTROL_PATH = "Control";
const MAX_HISTORY = 20;
const ADC_MAX = 4095;


let firebaseDb = null;
let firebaseRef = null;
let firebaseUpdate = null;
let firebaseSet = null;
let hasLiveFirebaseData = false;
let controlWriteWarningShown = false;
let demoTimer = null;


const state = {
  ph: 7.4,
  temp: 25.8,
  oxygen: 8.2,
  turbidity: 12,
  chlorophyll: 42,
  flow: 3.4,
  waterLevel: 82,
  co2Level: 420,
  mqInput: 2200,
  mqOutput: 1860,
  ldr: 2400,
  gasReduction: 15.5,
  processingIndex: 0.0775,
  algaeVolumeLiters: 3,
  runtimeHours: 2 / 3,
  pumpOn: true,
  lightOn: true,
  co2On: false,
  aeratorOn: true,
  doserOn: false,
  pumpSpeed: 65,
  lightIntensity: 78,
  co2Rate: 30,
  nutrientDose: 12,
  targetPh: 7.4,
  currentMode: "Auto",
  history: {
    ph: [7.1, 7.3, 7.2, 7.5, 7.4, 7.6, 7.4, 7.5, 7.3, 7.4],
    temp: [24.2, 24.7, 25.1, 25.5, 25.2, 25.9, 26.1, 25.8, 25.4, 25.8],
    oxygen: [7.1, 7.4, 7.8, 8.0, 8.4, 8.2, 8.5, 8.1, 8.3, 8.2],
    turbidity: [14, 13, 13, 12, 11, 12, 13, 12, 11, 12],
    chlorophyll: [36, 38, 40, 42, 43, 42, 44, 45, 43, 42],
    flow: [3.1, 3.2, 3.3, 3.4, 3.2, 3.5, 3.4, 3.3, 3.4, 3.4],
    co2Level: [2200, 2180, 2170, 2160, 2150, 2100, 2050, 1990, 1900, 1860],
    mqInput: [2200, 2180, 2170, 2160, 2150, 2150, 2140, 2145, 2142, 2150],
    mqOutput: [2200, 2100, 2010, 1930, 1860, 1840, 1810, 1800, 1795, 1860],
    ldr: [2700, 2650, 2600, 2520, 2460, 2420, 2380, 2360, 2410, 2400]
  },
  alerts: [
    { type: "good", title: "Dashboard ready", detail: "PhytoAir interface loaded with Firebase sensor support.", time: timeNow() },
    { type: "warning", title: "Waiting for live data", detail: "If Firebase has no data yet, demo values will stay visible.", time: timeNow() }
  ]
};


const $ = (id) => document.getElementById(id);


function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function randomAround(value, amount) {
  return value + (Math.random() * amount * 2 - amount);
}


function readNumber(source, keys, fallback = undefined) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") {
      const value = Number(source[key]);
      if (!Number.isNaN(value)) return value;
    }
  }
  return fallback;
}


function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}


function setBar(id, value, max) {
  const el = $(id);
  if (!el) return;
  el.style.width = `${clamp((value / max) * 100, 0, 100)}%`;
}


function pushHistory(key, value) {
  if (!state.history[key]) state.history[key] = [];
  if (typeof value !== "number" || Number.isNaN(value)) return;
  state.history[key].push(Number(value.toFixed(2)));
  state.history[key] = state.history[key].slice(-MAX_HISTORY);
}


function calculateGasReduction() {
  if (!state.mqInput || state.mqInput <= 0) return 0;
  return clamp(((state.mqInput - state.mqOutput) / state.mqInput) * 100, 0, 100);
}


function calculateProcessingIndex() {
  const eta = state.gasReduction / 100;
  const volume = state.algaeVolumeLiters || 3;
  const hours = state.runtimeHours || 2 / 3;
  return eta / volume * hours;
}


function calculateHealth() {
  let score = 100;


  if (state.ph < 6.8 || state.ph > 8.2) score -= 16;
  if (state.temp < 20 || state.temp > 30) score -= 14;
  if (state.oxygen < 6) score -= 14;
  if (state.turbidity > 30) score -= 12;
  if (state.waterLevel < 40) score -= 16;
  if (state.flow < 1.8) score -= 14;
  if (state.mqInput > 2500 || state.mqOutput > 2500) score -= 12;
  if (state.ldr < 1000) score -= 10;
  if (!state.pumpOn) score -= 12;
  if (!state.lightOn) score -= 8;


  return Math.round(clamp(score, 0, 100));
}


function setCardStatus(type, status) {
  const card = document.querySelector(`.sensor-card[data-type="${type}"]`);
  if (!card) return;
  card.classList.remove("warning", "danger");
  if (status === "warning" || status === "danger") card.classList.add(status);
}


function statusFor(value, rules) {
  if (rules.danger && rules.danger(value)) return "danger";
  if (rules.warning && rules.warning(value)) return "warning";
  return "good";
}


function updateDashboard() {
  state.gasReduction = calculateGasReduction();
  state.processingIndex = calculateProcessingIndex();


  const health = calculateHealth();
  const healthLabel = health >= 85 ? "Healthy" : health >= 65 ? "Warning" : "Critical";


  setText("healthScore", `${health}%`);
  setText("orbLabel", healthLabel);
  setText("healthText", health >= 85
    ? "System is stable. Live MQ-135, LDR, water quality, and control values are within safe ranges."
    : health >= 65
      ? "System needs attention. Check sensor values, alerts, and hardware before running long cycles."
      : "System is unstable. Use emergency stop and inspect the algae reactor hardware before continuing."
  );


  const orb = document.querySelector(".status-orb");
  if (orb) {
    const color = health >= 85 ? "var(--green)" : health >= 65 ? "var(--yellow)" : "var(--red)";
    orb.style.background = `conic-gradient(${color} 0 ${health}%, rgba(11, 36, 7, 0.08) ${health}% 100%)`;
  }


  setText("phValue", state.ph.toFixed(1));
  setText("tempValue", `${state.temp.toFixed(1)}°C`);
  setText("oxygenValue", `${state.oxygen.toFixed(1)} mg/L`);
  setText("turbidityValue", `${Math.round(state.turbidity)} NTU`);
  setText("chlorophyllValue", `${Math.round(state.chlorophyll)}%`);
  setText("flowValue", `${state.flow.toFixed(1)} L/min`);
  setText("waterLevelValue", `${Math.round(state.waterLevel)}%`);
  setText("co2LevelValue", `${Math.round(state.co2Level)} ADC`);


  setText("pumpSpeedLabel", state.pumpSpeed);
  setText("lightIntensityLabel", state.lightIntensity);
  setText("co2RateLabel", state.co2Rate);
  setText("nutrientDoseLabel", state.nutrientDose);
  setText("targetPhLabel", state.targetPh.toFixed(1));
  setText("currentMode", state.currentMode);
  setText("activeAlertCount", state.alerts.filter((alert) => alert.type !== "good").length);
  setText("lastSync", timeNow());


  setText("growthTag", `Biomass: ${Math.round(state.chlorophyll)}%`);
  setText("waterTag", `Gas reduction: ${state.gasReduction.toFixed(1)}%`);
  setText("controlTag", hasLiveFirebaseData ? "Firebase: Live" : "Firebase: Waiting");
  setText("connectionStatus", hasLiveFirebaseData ? "Firebase Live" : "Demo / Waiting");


  setBar("phBar", state.ph, 14);
  setBar("tempBar", state.temp, 40);
  setBar("oxygenBar", state.oxygen, 14);
  setBar("turbidityBar", state.turbidity, 60);
  setBar("chlorophyllBar", state.chlorophyll, 100);
  setBar("flowBar", state.flow, 6);
  setBar("waterLevelBar", state.waterLevel, 100);
  setBar("co2LevelBar", state.co2Level, ADC_MAX);


  setCardStatus("ph", statusFor(state.ph, {
    danger: (v) => v < 6.2 || v > 8.8,
    warning: (v) => v < 6.8 || v > 8.2
  }));
  setCardStatus("temp", statusFor(state.temp, {
    danger: (v) => v < 15 || v > 35,
    warning: (v) => v < 20 || v > 30
  }));
  setCardStatus("oxygen", statusFor(state.oxygen, {
    danger: (v) => v < 5,
    warning: (v) => v < 6
  }));
  setCardStatus("turbidity", statusFor(state.turbidity, {
    danger: (v) => v > 45,
    warning: (v) => v > 30
  }));
  setCardStatus("chlorophyll", statusFor(state.ldr, {
    danger: (v) => v < 600,
    warning: (v) => v < 1000
  }));
  setCardStatus("flow", statusFor(state.flow, {
    danger: (v) => v < 1.2,
    warning: (v) => v < 1.8 || v > 5.5
  }));
  setCardStatus("water", statusFor(state.waterLevel, {
    danger: (v) => v < 25,
    warning: (v) => v < 40
  }));
  setCardStatus("co2", statusFor(Math.max(state.mqInput, state.mqOutput), {
    danger: (v) => v > 3200,
    warning: (v) => v > 2500
  }));


  renderSensorTable();
  drawChart($("chartMode")?.value || "co2Level");
  renderAlerts();
}


function addAlert(type, title, detail) {
  const key = `${type}:${title}:${detail}`;
  const now = Date.now();
  const recentDuplicate = state.alerts.find((alert) => alert.key === key && now - alert.createdAt < 20000);
  if (recentDuplicate) return;


  state.alerts.unshift({ type, title, detail, time: timeNow(), createdAt: now, key });
  state.alerts = state.alerts.slice(0, 8);
  renderAlerts();
}


function renderAlerts() {
  const list = $("alertsList");
  if (!list) return;
  list.innerHTML = "";


  if (!state.alerts.length) {
    list.innerHTML = `
      <div class="alert-item good">
        <span class="alert-dot"></span>
        <div><strong>No alerts</strong><p class="muted">Everything looks clean right now.</p></div>
        <span class="alert-time">${timeNow()}</span>
      </div>
    `;
    setText("activeAlertCount", "0");
    return;
  }


  state.alerts.forEach((alert) => {
    const item = document.createElement("div");
    item.className = `alert-item ${alert.type}`;
    item.innerHTML = `
      <span class="alert-dot"></span>
      <div>
        <strong>${alert.title}</strong>
        <p class="muted">${alert.detail}</p>
      </div>
      <span class="alert-time">${alert.time}</span>
    `;
    list.appendChild(item);
  });


  setText("activeAlertCount", state.alerts.filter((alert) => alert.type !== "good").length);
}


function badgeClass(status) {
  return status === "danger" ? "danger" : status === "warning" ? "warning" : "";
}


function renderSensorRow(name, value, status, note = "") {
  const statusText = status === "danger" ? "Danger" : status === "warning" ? "Check" : "Good";
  return `
    <div class="sensor-row">
      <div>
        <strong>${name}</strong>
        ${note ? `<small>${note}</small>` : ""}
      </div>
      <span class="badge ${badgeClass(status)}">${value} · ${statusText}</span>
    </div>
  `;
}


function renderSensorTable() {
  const table = $("sensorStatusTable");
  if (!table) return;


  const mqInputStatus = statusFor(state.mqInput, {
    danger: (v) => v > 3200,
    warning: (v) => v > 2500
  });
  const mqOutputStatus = statusFor(state.mqOutput, {
    danger: (v) => v > 3200,
    warning: (v) => v > 2500
  });
  const ldrStatus = statusFor(state.ldr, {
    danger: (v) => v < 600,
    warning: (v) => v < 1000
  });
  const reductionStatus = statusFor(state.gasReduction, {
    danger: (v) => v < 0.5,
    warning: (v) => v < 5
  });


  table.innerHTML = [
    renderSensorRow("MQ-135 Input", `${Math.round(state.mqInput)} ADC`, mqInputStatus, "Raw gas signal before/near reactor input"),
    renderSensorRow("MQ-135 Output", `${Math.round(state.mqOutput)} ADC`, mqOutputStatus, "Raw gas signal after algae contact"),
    renderSensorRow("LDR Light", `${Math.round(state.ldr)} ADC`, ldrStatus, "Lower value means denser algae blocks more light"),
    renderSensorRow("Gas Reduction η", `${state.gasReduction.toFixed(1)}%`, reductionStatus, "Calculated from MQ-135 input/output difference"),
    renderSensorRow("Algae Processing K", state.processingIndex.toFixed(4), "good", "Relative efficiency per litre-hour"),
    renderSensorRow("Firebase", hasLiveFirebaseData ? "Live" : "Waiting", hasLiveFirebaseData ? "good" : "warning", SENSOR_PATH)
  ].join("");
}


function checkAlerts() {
  if (state.mqInput > 2500) {
    addAlert("danger", "MQ-135 input high", `Sensor 1 is reading ${Math.round(state.mqInput)} ADC.`);
  }
  if (state.mqOutput > 2500) {
    addAlert("danger", "MQ-135 output high", `Sensor 2 is reading ${Math.round(state.mqOutput)} ADC.`);
  }
  if (state.ldr < 1000) {
    addAlert("warning", "LDR light is low", "Algae may be too dense or grow lights may be weak.");
  }
  if (state.ph < 6.8 || state.ph > 8.2) {
    addAlert("warning", "pH value out of ideal range", `Current pH is ${state.ph.toFixed(1)}.`);
  }
  if (state.oxygen < 6) {
    addAlert("danger", "Low oxygen detected", "Increase aeration or check pump flow.");
  }
  if (state.turbidity > 30) {
    addAlert("warning", "High turbidity detected", `Current turbidity is ${Math.round(state.turbidity)} NTU.`);
  }
  if (state.waterLevel < 40) {
    addAlert("warning", "Low water level", `Water level is ${Math.round(state.waterLevel)}%.`);
  }
}


function applyFirebaseSensorData(data) {
  const mq1 = readNumber(data, ["MQ135_1", "mq135_1", "MQ1351", "mq1", "MQ1", "MQ135", "mq135"], state.mqInput);
  const mq2 = readNumber(data, ["MQ135_2", "mq135_2", "MQ1352", "mq2", "MQ2"], state.mqOutput);
  const ldr = readNumber(data, ["LDR", "ldr", "light", "lightSensor"], state.ldr);


  state.mqInput = mq1;
  state.mqOutput = mq2;
  state.ldr = ldr;


  const averageMq = (state.mqInput + state.mqOutput) / 2;
  state.co2Level = readNumber(data, ["co2Level", "CO2", "co2", "ppm", "PPM"], averageMq);
  state.chlorophyll = readNumber(data, ["chlorophyll", "algaeDensity", "density", "biomass"], clamp(100 - (state.ldr / ADC_MAX) * 100, 0, 100));


  state.ph = readNumber(data, ["ph", "pH", "PH"], state.ph);
  state.temp = readNumber(data, ["temp", "temperature", "Temperature"], state.temp);
  state.oxygen = readNumber(data, ["oxygen", "dissolvedOxygen", "DO"], state.oxygen);
  state.turbidity = readNumber(data, ["turbidity", "Turbidity", "ntu"], state.turbidity);
  state.flow = readNumber(data, ["flow", "flowRate", "Flow"], state.flow);
  state.waterLevel = readNumber(data, ["waterLevel", "water", "level"], state.waterLevel);


  state.pumpOn = data.pumpOn ?? data.pump ?? state.pumpOn;
  state.lightOn = data.lightOn ?? data.light ?? state.lightOn;
  state.co2On = data.co2On ?? data.co2Injector ?? state.co2On;
  state.aeratorOn = data.aeratorOn ?? data.aerator ?? state.aeratorOn;
  state.doserOn = data.doserOn ?? data.doser ?? state.doserOn;


  state.pumpSpeed = readNumber(data, ["pumpSpeed"], state.pumpSpeed);
  state.lightIntensity = readNumber(data, ["lightIntensity", "ledBrightness"], state.lightIntensity);
  state.co2Rate = readNumber(data, ["co2Rate"], state.co2Rate);
  state.nutrientDose = readNumber(data, ["nutrientDose"], state.nutrientDose);
  state.targetPh = readNumber(data, ["targetPh"], state.targetPh);


  pushHistory("mqInput", state.mqInput);
  pushHistory("mqOutput", state.mqOutput);
  pushHistory("ldr", state.ldr);
  pushHistory("co2Level", state.co2Level);
  pushHistory("chlorophyll", state.chlorophyll);
  pushHistory("ph", state.ph);
  pushHistory("temp", state.temp);
  pushHistory("oxygen", state.oxygen);
  pushHistory("turbidity", state.turbidity);
  pushHistory("flow", state.flow);


  syncControlInputs();
  checkAlerts();
  updateDashboard();
}


function drawChart(mode) {
  const canvas = $("qualityChart");
  if (!canvas) return;


  const ctx = canvas.getContext("2d");
  const data = state.history[mode] || [];
  const padding = 42;
  const width = canvas.width;
  const height = canvas.height;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const labelMap = {
    ph: "pH",
    temp: "Temperature",
    oxygen: "Oxygen",
    turbidity: "Turbidity",
    chlorophyll: "Algae Density",
    flow: "Flow Rate",
    co2Level: "CO₂ Estimate",
    mqInput: "MQ-135 Input",
    mqOutput: "MQ-135 Output",
    ldr: "LDR Light"
  };


  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(11, 36, 7, 0.12)";


  for (let i = 0; i <= 4; i++) {
    const y = padding + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }


  ctx.fillStyle = "rgba(11, 36, 7, 0.62)";
  ctx.font = "700 18px Inter, sans-serif";
  ctx.fillText(`${labelMap[mode] || mode} trend`, padding, 28);


  if (data.length < 2) {
    ctx.fillStyle = "rgba(11, 36, 7, 0.46)";
    ctx.font = "600 16px Inter, sans-serif";
    ctx.fillText("Waiting for more live Firebase data...", padding, height / 2);
    return;
  }


  const min = Math.min(...data);
  const max = Math.max(...data);
  const spread = max - min || 1;
  const chartMin = min - spread * 0.12;
  const chartMax = max + spread * 0.12;


  ctx.beginPath();
  data.forEach((value, index) => {
    const x = padding + (chartWidth / (data.length - 1)) * index;
    const y = padding + chartHeight - ((value - chartMin) / (chartMax - chartMin)) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#86bc1b";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();


  data.forEach((value, index) => {
    const x = padding + (chartWidth / (data.length - 1)) * index;
    const y = padding + chartHeight - ((value - chartMin) / (chartMax - chartMin)) * chartHeight;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#86bc1b";
    ctx.lineWidth = 3;
    ctx.stroke();
  });
}


function simulateSensorUpdate() {
  state.ph = clamp(randomAround(state.ph, 0.12), 6.2, 8.8);
  state.temp = clamp(randomAround(state.temp, 0.35), 18, 34);
  state.oxygen = clamp(randomAround(state.oxygen, 0.25), 4.5, 12);
  state.turbidity = clamp(randomAround(state.turbidity, 2.2), 4, 48);
  state.mqInput = clamp(randomAround(state.mqInput, 45), 100, ADC_MAX);
  state.mqOutput = clamp(randomAround(state.mqOutput, 55), 100, ADC_MAX);
  state.ldr = clamp(randomAround(state.ldr, 80), 0, ADC_MAX);
  state.co2Level = (state.mqInput + state.mqOutput) / 2;
  state.chlorophyll = clamp(100 - (state.ldr / ADC_MAX) * 100, 0, 100);
  state.flow = clamp(randomAround(state.flow, 0.16), 1.2, 5.8);
  state.waterLevel = clamp(randomAround(state.waterLevel, 1.2), 20, 100);


  ["ph", "temp", "oxygen", "turbidity", "mqInput", "mqOutput", "ldr", "co2Level", "chlorophyll", "flow"].forEach((key) => {
    pushHistory(key, state[key]);
  });


  checkAlerts();
  updateDashboard();
}


function syncControlInputs() {
  const mappings = [
    ["pumpToggle", "checked", state.pumpOn],
    ["lightToggle", "checked", state.lightOn],
    ["co2Toggle", "checked", state.co2On],
    ["aeratorToggle", "checked", state.aeratorOn],
    ["doserToggle", "checked", state.doserOn],
    ["pumpSpeed", "value", state.pumpSpeed],
    ["lightIntensity", "value", state.lightIntensity],
    ["co2Rate", "value", state.co2Rate],
    ["nutrientDose", "value", state.nutrientDose],
    ["targetPh", "value", Math.round(state.targetPh * 10)]
  ];


  mappings.forEach(([id, prop, value]) => {
    const el = $(id);
    if (el) el[prop] = value;
  });
}


async function writeControl(payload) {
  if (!firebaseDb || !firebaseRef || !firebaseUpdate) return;


  try {
    await firebaseUpdate(firebaseRef(firebaseDb, CONTROL_PATH), {
      ...payload,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.warn("Firebase control write failed:", error);
    if (!controlWriteWarningShown) {
      controlWriteWarningShown = true;
      addAlert("warning", "Control write failed", "Check Firebase Database rules if ESP32 control commands are not saved.");
    }
  }
}


function bindControl(id, stateKey, label, type = "checkbox") {
  const element = $(id);
  if (!element) return;


  const eventName = type === "range" ? "input" : "change";
  element.addEventListener(eventName, () => {
    state[stateKey] = type === "range" ? Number(element.value) : element.checked;


    if (stateKey === "targetPh") state[stateKey] = Number(element.value) / 10;


    updateDashboard();
    writeControl({ [stateKey]: state[stateKey] });


    if (type === "checkbox") {
      addAlert(element.checked ? "good" : "warning", `${label} changed`, `${label} turned ${element.checked ? "on" : "off"}.`);
    }
  });
}


function setupControls() {
  bindControl("pumpToggle", "pumpOn", "Water pump");
  bindControl("lightToggle", "lightOn", "Grow lights");
  bindControl("co2Toggle", "co2On", "CO₂ injector");
  bindControl("aeratorToggle", "aeratorOn", "Aerator");
  bindControl("doserToggle", "doserOn", "Nutrient doser");
  bindControl("pumpSpeed", "pumpSpeed", "Pump speed", "range");
  bindControl("lightIntensity", "lightIntensity", "Light intensity", "range");
  bindControl("co2Rate", "co2Rate", "CO₂ injection rate", "range");
  bindControl("nutrientDose", "nutrientDose", "Nutrient dose", "range");
  bindControl("targetPh", "targetPh", "Target pH", "range");


  document.querySelectorAll(".mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      state.currentMode = button.dataset.mode;
      setText("currentMode", state.currentMode);
      writeControl({ mode: state.currentMode });
      addAlert("good", "Mode changed", `System mode set to ${state.currentMode}.`);
    });
  });


  $("chartMode")?.addEventListener("change", (event) => drawChart(event.target.value));


  $("refreshBtn")?.addEventListener("click", () => {
    if (!hasLiveFirebaseData) simulateSensorUpdate();
    updateDashboard();
    addAlert("good", "Data refreshed", hasLiveFirebaseData ? "Latest Firebase sensor values are displayed." : "Demo sensor values were refreshed.");
  });


  $("simulateProblemBtn")?.addEventListener("click", () => {
    state.mqInput = 2850;
    state.mqOutput = 2600;
    state.ldr = 780;
    state.turbidity = 36;
    state.chlorophyll = clamp(100 - (state.ldr / ADC_MAX) * 100, 0, 100);
    state.co2Level = (state.mqInput + state.mqOutput) / 2;
    checkAlerts();
    updateDashboard();
  });


  $("calibrateSensorsBtn")?.addEventListener("click", () => {
    addAlert("good", "Calibration started", "Sensor calibration command was sent to Firebase Control/calibrateSensors.");
    writeControl({ calibrateSensors: true });
  });


  $("runCleanCycle")?.addEventListener("click", () => {
    addAlert("good", "Clean cycle started", "Cleaning command was sent to Firebase Control/runCleanCycle.");
    writeControl({ runCleanCycle: true });
  });


  $("primePumpBtn")?.addEventListener("click", () => {
    addAlert("good", "Pump primed", "Prime pump command was sent to Firebase Control/primePump.");
    writeControl({ primePump: true });
  });


  $("doseNutrientsBtn")?.addEventListener("click", () => {
    addAlert("good", "Nutrient dosing", "Dose nutrients command was sent to Firebase Control/doseNutrients.");
    writeControl({ doseNutrients: true });
  });


  $("testAlertBtn")?.addEventListener("click", () => {
    addAlert("warning", "Test alert", "Alert system is working correctly.");
  });


  $("clearAlerts")?.addEventListener("click", () => {
    state.alerts = [];
    renderAlerts();
  });


  $("emergencyStop")?.addEventListener("click", async () => {
    state.pumpOn = false;
    state.lightOn = false;
    state.co2On = false;
    state.aeratorOn = false;
    state.doserOn = false;
    state.pumpSpeed = 0;
    state.lightIntensity = 0;


    syncControlInputs();
    updateDashboard();
    addAlert("danger", "Emergency stop activated", "All controllable systems were turned off in the dashboard.");


    if (firebaseDb && firebaseRef && firebaseSet) {
      try {
        await firebaseSet(firebaseRef(firebaseDb, CONTROL_PATH), {
          pumpOn: false,
          lightOn: false,
          co2On: false,
          aeratorOn: false,
          doserOn: false,
          pumpSpeed: 0,
          lightIntensity: 0,
          emergencyStop: true,
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        console.warn("Emergency stop Firebase write failed:", error);
      }
    }
  });
}


async function connectFirebase() {
  try {
    const firebaseAppModule = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
    const firebaseDatabaseModule = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");


    const { initializeApp } = firebaseAppModule;
    const { getDatabase, ref, onValue, set, update } = firebaseDatabaseModule;


    const app = initializeApp(firebaseConfig);
    firebaseDb = getDatabase(app);
    firebaseRef = ref;
    firebaseSet = set;
    firebaseUpdate = update;


    setText("connectionStatus", "Firebase Connected");


    onValue(ref(firebaseDb, SENSOR_PATH), (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        addAlert("warning", "No Firebase sensor data", `No values found at /${SENSOR_PATH}.`);
        updateDashboard();
        return;
      }


      hasLiveFirebaseData = true;
      if (demoTimer) {
        clearInterval(demoTimer);
        demoTimer = null;
      }


      applyFirebaseSensorData(data);
    }, (error) => {
      console.warn("Firebase read failed:", error);
      addAlert("danger", "Firebase read failed", "Check your Firebase rules, database URL, or internet connection.");
      setText("connectionStatus", "Firebase Error");
      startDemoMode();
    });
  } catch (error) {
    console.warn("Firebase import failed:", error);
    addAlert("warning", "Firebase not loaded", "The dashboard is running in demo mode. Use Live Server with internet access for real sensors.");
    setText("connectionStatus", "Demo Mode");
    startDemoMode();
  }
}


function startDemoMode() {
  if (demoTimer) return;
  demoTimer = setInterval(() => {
    if (!hasLiveFirebaseData) simulateSensorUpdate();
  }, 12000);
}


setupControls();
syncControlInputs();
updateDashboard();
connectFirebase();


setTimeout(() => {
  if (!hasLiveFirebaseData) startDemoMode();
}, 4000);



