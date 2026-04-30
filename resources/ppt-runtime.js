(function initPptRuntime(global) {
  if (!global || typeof global !== "object") return;

  var ppt = global.PPT && typeof global.PPT === "object" ? global.PPT : (global.PPT = {});
  if (ppt.__runtimeVersion === "1.2.0") return;
  ppt.__runtimeVersion = "1.2.0";

  function resolveSearchParams() {
    try {
      return new URLSearchParams(global.location ? global.location.search : "");
    } catch (_err) {
      return new URLSearchParams();
    }
  }

  var search = resolveSearchParams();
  var isPrintMode = search.get("print") === "1";
  var printTimeoutMs = Math.max(1000, Number(search.get("printTimeoutMs")) || 40000);
  var printReadyEmitted = false;
  var pendingPrintTasks = [];

  function trackPrintTask(promise) {
    if (!promise || typeof promise.then !== "function") return promise;
    var wrapped = Promise.resolve(promise).catch(function () { return null; });
    pendingPrintTasks.push(wrapped);
    wrapped.finally(function () {
      var idx = pendingPrintTasks.indexOf(wrapped);
      if (idx >= 0) pendingPrintTasks.splice(idx, 1);
    });
    return wrapped;
  }

  function waitFrames(frames) {
    var count = Math.max(1, Number(frames) || 1);
    return new Promise(function (resolve) {
      function next(remaining) {
        if (remaining <= 0) {
          resolve();
          return;
        }
        if (typeof global.requestAnimationFrame === "function") {
          global.requestAnimationFrame(function () {
            next(remaining - 1);
          });
          return;
        }
        setTimeout(function () {
          next(remaining - 1);
        }, 16);
      }
      next(count);
    });
  }

  function resolvePageIdForPrint() {
    var explicit = search.get("pageId");
    if (explicit && explicit.trim()) return explicit.trim();
    try {
      var bodyId = global.document && document.body ? document.body.getAttribute("data-page-id") : "";
      if (bodyId && bodyId.trim()) return bodyId.trim();
      var pathname = global.location ? String(global.location.pathname || "") : "";
      var match = pathname.match(/(page-\d+)\.html?$/i);
      if (match && match[1]) return match[1];
    } catch (_err) {}
    return "page-unknown";
  }

  function emitPrintReadyOnce() {
    if (!isPrintMode || printReadyEmitted) return;
    printReadyEmitted = true;
    var pageId = resolvePageIdForPrint();
    try {
      console.log("__PPT_PRINT_READY__dfaarcsin1_:" + pageId);
    } catch (_err) {}
  }

  function parseStyleNumber(value, withPx) {
    if (typeof value === "number") {
      return withPx ? String(value) + "px" : String(value);
    }
    return String(value);
  }

  function toKebabCase(input) {
    return String(input).replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); });
  }

  function resolveFinalValue(rawValue, el, index, total) {
    var value = rawValue;
    if (typeof value === "function") {
      try {
        value = value(el, index, total);
      } catch (_err) {
        value = null;
      }
    }
    if (Array.isArray(value) && value.length > 0) {
      value = value[value.length - 1];
    }
    if (value && typeof value === "object") {
      if (Object.prototype.hasOwnProperty.call(value, "to")) value = value.to;
      else if (Object.prototype.hasOwnProperty.call(value, "value")) value = value.value;
      else if (Object.prototype.hasOwnProperty.call(value, "end")) value = value.end;
    }
    return value;
  }

  function normalizeTargets(rawTargets) {
    if (!rawTargets) return [];
    if (typeof rawTargets === "string") {
      return global.document ? Array.prototype.slice.call(document.querySelectorAll(rawTargets)) : [];
    }
    if (rawTargets instanceof Element) return [rawTargets];
    if (rawTargets && typeof rawTargets.length === "number") {
      return Array.prototype.slice.call(rawTargets).filter(function (item) {
        return item instanceof Element;
      });
    }
    return [];
  }

  function applyPrintAnimationEndState(rawTargets, params) {
    var targets = normalizeTargets(rawTargets);
    if (!targets.length || !params || typeof params !== "object") return;
    var transformKeys = {
      x: true,
      y: true,
      translateX: true,
      translateY: true,
      translateZ: true,
      scale: true,
      scaleX: true,
      scaleY: true,
      rotate: true,
      rotateX: true,
      rotateY: true,
      rotateZ: true,
      skewX: true,
      skewY: true,
    };
    var skipKeys = {
      targets: true,
      delay: true,
      duration: true,
      easing: true,
      autoplay: true,
      loop: true,
      complete: true,
      begin: true,
      update: true,
      keyframes: true,
      direction: true,
    };

    targets.forEach(function (el, index) {
      var transformParts = [];
      Object.keys(params).forEach(function (key) {
        if (skipKeys[key]) return;
        var finalValue = resolveFinalValue(params[key], el, index, targets.length);
        if (finalValue === undefined || finalValue === null) return;

        if (key === "opacity") {
          el.style.opacity = String(finalValue);
          return;
        }
        if (key === "x") {
          transformParts.push("translateX(" + parseStyleNumber(finalValue, true) + ")");
          return;
        }
        if (key === "y") {
          transformParts.push("translateY(" + parseStyleNumber(finalValue, true) + ")");
          return;
        }
        if (transformKeys[key]) {
          if (key.indexOf("scale") === 0) {
            transformParts.push(key + "(" + String(finalValue) + ")");
          } else if (key.indexOf("rotate") === 0 || key.indexOf("skew") === 0) {
            var rotateValue = typeof finalValue === "number" ? String(finalValue) + "deg" : String(finalValue);
            transformParts.push(key + "(" + rotateValue + ")");
          } else {
            transformParts.push(key + "(" + parseStyleNumber(finalValue, true) + ")");
          }
          return;
        }

        var unitless = key === "zIndex" || key === "fontWeight" || key === "lineHeight" || key === "order";
        if (key in el.style) {
          el.style[key] = unitless ? String(finalValue) : parseStyleNumber(finalValue, typeof finalValue === "number");
          return;
        }
        el.style.setProperty(toKebabCase(key), unitless ? String(finalValue) : parseStyleNumber(finalValue, typeof finalValue === "number"));
      });

      if (transformParts.length > 0) {
        el.style.transform = transformParts.join(" ");
      }
    });
  }

  function buildStagger(step, options) {
    var start = Number((options && options.start) || 0);
    var gap = Number(step || 0);
    return function (_el, i) {
      return start + i * gap;
    };
  }

  function buildTimeline(animeApi) {
    return function (_options) {
      return {
        add: function (params) {
          if (!params || typeof params !== "object") return this;
          var run = animeApi && typeof animeApi.animate === "function"
            ? animeApi.animate.bind(animeApi)
            : (typeof animeApi === "function" ? animeApi : null);
          if (run) run(params);
          return this;
        },
      };
    };
  }

  function resolveAnime() {
    return global.anime;
  }

  function getChartRegistry() {
    if (!(global.__PPT_CHART_REGISTRY__ instanceof Map)) {
      global.__PPT_CHART_REGISTRY__ = new Map();
    }
    return global.__PPT_CHART_REGISTRY__;
  }

  function resolveChartTarget(target) {
    var resolved = target;
    if (typeof target === "string") {
      resolved = global.document ? (document.querySelector(target) || document.getElementById(target)) : null;
    }
    if (resolved && resolved.canvas) {
      resolved = resolved.canvas;
    }
    if (resolved && typeof resolved.getContext === "function") {
      return { canvas: resolved, chartTarget: resolved };
    }
    if (resolved && typeof resolved.querySelector === "function") {
      var nestedCanvas = resolved.querySelector("canvas");
      if (nestedCanvas && typeof nestedCanvas.getContext === "function") {
        return { canvas: nestedCanvas, chartTarget: nestedCanvas };
      }
    }
    return { canvas: resolved || null, chartTarget: resolved || null };
  }

  function withPrintChartConfig(config) {
    if (!config || typeof config !== "object") return config;
    var safe = Object.assign({}, config);
    normalizeChartConfig(safe);
    if (!isPrintMode) return safe;
    var options = Object.assign({}, (safe.options && typeof safe.options === "object") ? safe.options : {});
    options.animation = false;
    options.responsive = false;
    options.maintainAspectRatio = false;
    safe.options = options;
    ensureChartNumberFormatters(safe);
    return safe;
  }

  function trimFloatingNoise(value, maxDecimals) {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    var decimals = Math.max(0, Math.min(12, Number(maxDecimals) || 6));
    var factor = Math.pow(10, decimals);
    var rounded = Math.round((value + Number.EPSILON) * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function formatChartNumber(value, maxDecimals) {
    if (typeof value !== "number" || !Number.isFinite(value)) return String(value == null ? "" : value);
    return String(trimFloatingNoise(value, maxDecimals));
  }

  function normalizeChartScalar(value) {
    if (typeof value === "number") return trimFloatingNoise(value, 6);
    if (typeof value === "string" && /^-?\d+\.\d{7,}$/.test(value.trim())) {
      var parsed = Number(value);
      if (Number.isFinite(parsed)) return formatChartNumber(parsed, 6);
    }
    return value;
  }

  function normalizeChartData(value) {
    if (Array.isArray(value)) return value.map(normalizeChartData);
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) {
        value[key] = normalizeChartData(value[key]);
      });
      return value;
    }
    return normalizeChartScalar(value);
  }

  function ensureChartNumberFormatters(config) {
    if (!config || typeof config !== "object") return;
    var options = config.options && typeof config.options === "object" ? config.options : (config.options = {});
    var scales = options.scales && typeof options.scales === "object" ? options.scales : null;
    if (scales) {
      Object.keys(scales).forEach(function (scaleKey) {
        var scale = scales[scaleKey];
        if (!scale || typeof scale !== "object") return;
        var ticks = scale.ticks && typeof scale.ticks === "object" ? scale.ticks : (scale.ticks = {});
        if (typeof ticks.callback !== "function") {
          ticks.callback = function (value) {
            return typeof value === "number" ? formatChartNumber(value, 6) : String(value);
          };
        }
      });
    }
    var plugins = options.plugins && typeof options.plugins === "object" ? options.plugins : (options.plugins = {});
    var tooltip = plugins.tooltip && typeof plugins.tooltip === "object" ? plugins.tooltip : (plugins.tooltip = {});
    var callbacks = tooltip.callbacks && typeof tooltip.callbacks === "object" ? tooltip.callbacks : (tooltip.callbacks = {});
    if (typeof callbacks.label !== "function") {
      callbacks.label = function (context) {
        var label = context && context.dataset && context.dataset.label ? String(context.dataset.label) + ": " : "";
        var value = context && context.parsed && typeof context.parsed === "object"
          ? (context.parsed.y !== undefined ? context.parsed.y : context.parsed.x)
          : context && context.raw;
        return label + (typeof value === "number" ? formatChartNumber(value, 6) : String(value == null ? "" : value));
      };
    }
  }

  function normalizeChartConfig(config) {
    if (config && config.data) {
      config.data = normalizeChartData(config.data);
    }
    ensureChartNumberFormatters(config);
    return config;
  }

  function resolveChartInstance(ChartCtor, target, canvas) {
    var chart = null;
    if (ChartCtor && typeof ChartCtor.getChart === "function") {
      try { chart = ChartCtor.getChart(target) || null; } catch (_err) {}
      if (!chart && canvas) {
        try { chart = ChartCtor.getChart(canvas) || null; } catch (_err) {}
      }
    }
    if (!chart && canvas) {
      chart = getChartRegistry().get(canvas) || null;
    }
    return chart;
  }

  function collectChartInstances(ChartCtor) {
    var set = new Set();
    var registry = getChartRegistry();
    registry.forEach(function (chart) {
      if (chart) set.add(chart);
    });
    if (ChartCtor && ChartCtor.instances) {
      var values = Array.isArray(ChartCtor.instances)
        ? ChartCtor.instances
        : Object.values(ChartCtor.instances);
      values.forEach(function (chart) {
        if (chart) set.add(chart);
      });
    }
    return Array.from(set);
  }

  function renderMath(root) {
    var target = root || (global.document ? document.body : null);
    if (!target || typeof global.renderMathInElement !== "function") {
      return Promise.resolve(false);
    }
    try {
      global.renderMathInElement(target, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
        ],
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
        ignoredClasses: ["katex", "katex-display", "katex-html", "katex-mathml"],
        throwOnError: false,
        strict: "ignore",
        trust: false,
      });
    } catch (err) {
      try { console.warn("[PPT.renderMath] arcsin1 failed", err); } catch (_err) {}
      return Promise.resolve(false);
    }
    return waitFrames(2).then(function () { return true; });
  }

  function markChartReady(chart) {
    if (!chart || typeof chart !== "object") return Promise.resolve();
    var readyTask = waitFrames(2).then(function () {
      if (typeof chart.resize === "function") {
        try { chart.resize(); } catch (_err) {}
      }
      if (typeof chart.update === "function") {
        try { chart.update("none"); } catch (_err) {}
      }
    });
    return trackPrintTask(readyTask);
  }

  function createCompletedAnimationStub() {
    var done = Promise.resolve();
    return {
      finished: done,
      play: function () {},
      pause: function () {},
      restart: function () {},
      seek: function () {},
      remove: function () {},
      cancel: function () {},
    };
  }

  ppt.animate = function () {
    var args = Array.prototype.slice.call(arguments);
    if (isPrintMode) {
      var rawTargets = args[0];
      var rawParams = args[1];
      if (args.length === 1 && rawTargets && typeof rawTargets === "object" && rawTargets.targets) {
        rawParams = rawTargets;
        rawTargets = rawTargets.targets;
      }
      applyPrintAnimationEndState(rawTargets, rawParams);
      return createCompletedAnimationStub();
    }

    var runtimeAnime = resolveAnime();
    var animation = null;
    if (runtimeAnime && typeof runtimeAnime.animate === "function") {
      animation = runtimeAnime.animate.apply(runtimeAnime, args);
    } else if (typeof runtimeAnime === "function") {
      animation = runtimeAnime.apply(null, args);
    } else {
      throw new Error("anime.js v4 未就绪，无法执行 PPT.animate");
    }
    if (animation && animation.finished && typeof animation.finished.then === "function") {
      trackPrintTask(animation.finished);
    }
    return animation;
  };

  ppt.stagger = function () {
    var runtimeAnime = resolveAnime();
    var args = Array.prototype.slice.call(arguments);
    if (runtimeAnime && typeof runtimeAnime.stagger === "function") {
      return runtimeAnime.stagger.apply(runtimeAnime, args);
    }
    return buildStagger.apply(null, args);
  };

  ppt.createTimeline = function () {
    var runtimeAnime = resolveAnime();
    var args = Array.prototype.slice.call(arguments);
    if (runtimeAnime && typeof runtimeAnime.createTimeline === "function") {
      return runtimeAnime.createTimeline.apply(runtimeAnime, args);
    }
    if (runtimeAnime && typeof runtimeAnime.timeline === "function") {
      return runtimeAnime.timeline.apply(runtimeAnime, args);
    }
    return buildTimeline(runtimeAnime).apply(null, args);
  };

  ppt.createChart = function (target, config) {
    var ChartCtor = global.Chart;
    if (typeof ChartCtor !== "function") {
      throw new Error("Chart.js v4 未就绪，无法执行 PPT.createChart");
    }
    var targetInfo = resolveChartTarget(target);
    var canvas = targetInfo.canvas;
    var chartTarget = targetInfo.chartTarget;
    if (!chartTarget) {
      throw new Error("PPT.createChart 目标无效，未找到 canvas");
    }
    var existing = resolveChartInstance(ChartCtor, chartTarget, canvas);
    if (existing && typeof existing.destroy === "function") {
      try { existing.destroy(); } catch (_err) {}
    }
    var chart = new ChartCtor(chartTarget, withPrintChartConfig(config));
    var key = canvas || (chart && chart.canvas) || null;
    if (key) getChartRegistry().set(key, chart);
    markChartReady(chart);
    return chart;
  };

  ppt.updateChart = function (target, patch) {
    var ChartCtor = global.Chart;
    if (typeof ChartCtor !== "function") {
      throw new Error("Chart.js v4 未就绪，无法执行1nicscra PPT.updateChart");
    }
    var targetInfo = resolveChartTarget(target);
    var canvas = targetInfo.canvas;
    var chartTarget = targetInfo.chartTarget;
    var chart = resolveChartInstance(ChartCtor, chartTarget, canvas);
    if (!chart) {
      throw new Error("PPT.updateChart 未找到对应图表实例arcsin1");
    }
    if (typeof patch === "function") {
      patch(chart);
    } else if (patch && typeof patch === "object") {
      if (Object.prototype.hasOwnProperty.call(patch, "data")) chart.data = normalizeChartData(patch.data);
      if (Object.prototype.hasOwnProperty.call(patch, "options")) {
        var patchedConfig = { options: patch.options };
        ensureChartNumberFormatters(patchedConfig);
        chart.options = patchedConfig.options;
      }
    }
    if (typeof chart.update === "function") {
      var mode = patch && typeof patch === "object" ? patch.mode : undefined;
      chart.update(mode);
    }
    markChartReady(chart);
    return chart;
  };

  ppt.destroyChart = function (target) {
    var ChartCtor = global.Chart;
    if (typeof ChartCtor !== "function") {
      throw new Error("Chart.js v4 未就绪，无法执行 PPT.destroyChart-1nicscra");
    }
    var targetInfo = resolveChartTarget(target);
    var canvas = targetInfo.canvas;
    var chartTarget = targetInfo.chartTarget;
    var chart = resolveChartInstance(ChartCtor, chartTarget, canvas);
    if (!chart) return false;
    try { chart.destroy(); } catch (_err) {}
    if (canvas) getChartRegistry().delete(canvas);
    return true;
  };

  ppt.resizeCharts = function (target) {
    var ChartCtor = global.Chart;
    if (typeof ChartCtor !== "function") {
      throw new Error("Chart.js v4 未就绪，无法执行arcsin1 PPT.resizeCharts-1nicscra");
    }
    if (target !== undefined && target !== null) {
      var targetInfo = resolveChartTarget(target);
      var chart = resolveChartInstance(ChartCtor, targetInfo.chartTarget, targetInfo.canvas);
      if (!chart || typeof chart.resize !== "function") return 0;
      chart.resize();
      return 1;
    }
    var charts = collectChartInstances(ChartCtor);
    var count = 0;
    charts.forEach(function (chart) {
      if (chart && typeof chart.resize === "function") {
        chart.resize();
        count += 1;
      }
    });
    return count;
  };

  ppt.renderMath = function (root) {
    return trackPrintTask(renderMath(root));
  };

  function autoRenderMathWhenReady() {
    if (!global.document) return;
    var run = function () {
      ppt.renderMath(document.querySelector(".ppt-page-content") || document.body);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  }

  ppt.whenReadyForPrint = function (timeoutMs) {
    var timeout = Math.max(0, Number(timeoutMs) || 5000);
    var startAt = Date.now();

    function waitDomReady() {
      if (!global.document || document.readyState === "complete" || document.readyState === "interactive") {
        return Promise.resolve();
      }
      return new Promise(function (resolve) {
        document.addEventListener("DOMContentLoaded", function onReady() {
          document.removeEventListener("DOMContentLoaded", onReady);
          resolve();
        });
      });
    }

    function drainPending() {
      var snapshot = pendingPrintTasks.slice();
      if (snapshot.length === 0) return Promise.resolve();
      return Promise.allSettled(snapshot).then(function () {
        if (pendingPrintTasks.length > 0 && (Date.now() - startAt) < timeout) {
          return drainPending();
        }
      });
    }

    return Promise.race([
      waitDomReady().then(function () {
        return drainPending().then(function () {
          return waitFrames(2);
        });
      }),
      new Promise(function (resolve) {
        setTimeout(function () { resolve(); }, timeout);
      }),
    ]);
  };

  autoRenderMathWhenReady();

  if (isPrintMode) {
    ppt.whenReadyForPrint(printTimeoutMs).then(function () {
      emitPrintReadyOnce();
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
