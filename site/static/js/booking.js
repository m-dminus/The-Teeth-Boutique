/* The Teeth Boutique - scheduling widget.
   Talks to the practice's own booking service; no third-party scheduler.
   Config: set window.TB_API_BASE before this script to point elsewhere. */
(function () {
  "use strict";

  var API = window.TB_API_BASE || "https://api.theteethboutique.com";
  var DEMO = !!window.TB_BOOKING_DEMO;
  var TZ = "America/Chicago";
  var WINDOW_DAYS = 14;
  var MAX_OFFSET = 2; // 3 windows of 14 days ~ the 45-day horizon

  var REASONS = [
    { id: "new-patient", label: "New patient exam", minutes: 60 },
    { id: "checkup", label: "Cleaning & checkup", minutes: 60 },
    { id: "emergency", label: "Emergency / in pain", minutes: 30 },
    { id: "consult", label: "Consultation \u2014 cosmetic, Invisalign, implants", minutes: 30 },
    { id: "other", label: "Something else", minutes: 30 }
  ];

  // notice: a one-line message shown under step 3 (e.g. the slot was taken
  // between pick and submit). Cleared whenever the user picks again.
  var state = { reason: null, offset: 0, day: null, slot: null, byDay: {}, loading: false, notice: null };

  // ---------- date helpers ----------
  function chicagoDateStr(d) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function fmtTime(iso) {
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  }
  function fmtDayLong(dateStr) {
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" })
      .format(new Date(dateStr + "T12:00:00-05:00"));
  }
  function fmtDayChip(dateStr) {
    var d = new Date(dateStr + "T12:00:00-05:00");
    return {
      dow: new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d),
      num: new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "numeric" }).format(d),
      mon: new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short" }).format(d)
    };
  }
  function hourInChicago(iso) {
    return parseInt(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date(iso)), 10);
  }
  function reasonById(id) {
    for (var i = 0; i < REASONS.length; i++) if (REASONS[i].id === id) return REASONS[i];
    return null;
  }
  // True for a string the Date parser accepts (the API's startsAt timestamps).
  function isDateString(v) {
    return typeof v === "string" && !isNaN(new Date(v).getTime());
  }

  // ---------- demo availability (design preview only) ----------
  function demoAvailability(fromStr) {
    var byDay = {}, today = chicagoDateStr(new Date());
    for (var i = 0; i < WINDOW_DAYS; i++) {
      var day = addDays(fromStr, i);
      if (day <= today) continue;
      var dow = new Date(day + "T12:00:00-05:00").getUTCDay();
      var hours = dow === 1 || dow === 3 ? ["09:30", "16:30"] : dow === 6 ? ["09:00", "14:30"] : null;
      if (!hours) continue;
      var slots = [];
      var h = parseInt(hours[0].slice(0, 2), 10), m = parseInt(hours[0].slice(3), 10);
      var endH = parseInt(hours[1].slice(0, 2), 10), endM = parseInt(hours[1].slice(3), 10);
      while (h < endH || (h === endH && m <= endM)) {
        var seed = 0, key = day + h + ":" + m;
        for (var k = 0; k < key.length; k++) seed = (seed * 31 + key.charCodeAt(k)) % 997;
        if (seed % 10 >= 4) {
          slots.push(day + "T" + (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":00-05:00");
        }
        m += 30; if (m >= 60) { m = 0; h++; }
      }
      if (slots.length) byDay[day] = slots;
    }
    return byDay;
  }

  // ---------- data ----------
  function loadAvailability(root, cb) {
    var from = addDays(chicagoDateStr(new Date()), state.offset * WINDOW_DAYS);
    state.loading = true;
    render(root);
    if (DEMO) {
      setTimeout(function () {
        state.byDay = demoAvailability(from);
        state.from = from;
        state.loading = false;
        cb();
      }, 150);
      return;
    }
    var url = API + "/api/appointments/availability?reason=" + encodeURIComponent(state.reason) +
              "&from=" + from + "&days=" + WINDOW_DAYS;
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error("availability " + r.status);
      return r.json();
    }).then(function (d) {
      state.byDay = d.byDay || {};
      state.from = d.from || from;
      state.loading = false;
      cb();
    }).catch(function () {
      state.loading = false;
      state.offline = true;
      cb();
    });
  }

  // ---------- rendering ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render(root) {
    var box = root.querySelector(".bk-box") || root.appendChild(el("div", "bk-box"));
    box.innerHTML = "";

    // A held time outranks an availability failure: both can be set when the
    // user re-picks a reason while the request is in flight and that reload
    // fails, and the confirmation is what matters then.
    if (state.done) { renderDone(box); return; }
    if (state.offline) { renderOffline(box); return; }

    // Step 1 - reason
    var s1 = el("div", "bk-step");
    s1.appendChild(el("p", "bk-step-label", "1 \u00b7 What are you coming in for?"));
    var pills = el("div", "bk-pills");
    REASONS.forEach(function (r) {
      var b = el("button", "bk-pill", r.label);
      b.type = "button";
      b.setAttribute("aria-pressed", state.reason === r.id ? "true" : "false");
      b.addEventListener("click", function () {
        state.reason = r.id; state.day = null; state.slot = null; state.offset = 0; state.notice = null;
        loadAvailability(root, function () { render(root); });
      });
      pills.appendChild(b);
    });
    s1.appendChild(pills);
    if (state.reason === "emergency") {
      s1.appendChild(el("p", "bk-note", "In pain right now? Calling 773-857-2290 is faster \u2014 emergencies are triaged by phone."));
    }
    box.appendChild(s1);
    if (!state.reason) return;

    if (state.loading) { box.appendChild(el("p", "bk-note", "Checking the calendar\u2026")); return; }

    // Step 2 - day
    var s2 = el("div", "bk-step");
    var head = el("div", "bk-days-head");
    head.appendChild(el("p", "bk-step-label", "2 \u00b7 Pick a day"));
    var nav = el("div", "bk-nav");
    var prev = el("button", "bk-navbtn", "\u2039 Earlier");
    prev.type = "button"; prev.disabled = state.offset === 0;
    prev.addEventListener("click", function () {
      state.offset--; state.day = null; state.slot = null;
      loadAvailability(root, function () { render(root); });
    });
    var next = el("button", "bk-navbtn", "Later \u203a");
    next.type = "button"; next.disabled = state.offset >= MAX_OFFSET;
    next.addEventListener("click", function () {
      state.offset++; state.day = null; state.slot = null;
      loadAvailability(root, function () { render(root); });
    });
    nav.appendChild(prev); nav.appendChild(next);
    head.appendChild(nav);
    s2.appendChild(head);

    var days = el("div", "bk-days");
    for (var i = 0; i < WINDOW_DAYS; i++) {
      var dayStr = addDays(state.from, i);
      var chip = fmtDayChip(dayStr);
      var has = (state.byDay[dayStr] || []).length > 0;
      var b2 = el("button", "bk-day" + (has ? "" : " bk-day-off"));
      b2.type = "button";
      b2.disabled = !has;
      b2.setAttribute("aria-pressed", state.day === dayStr ? "true" : "false");
      b2.appendChild(el("span", "bk-day-dow", chip.dow));
      b2.appendChild(el("span", "bk-day-num", chip.num));
      b2.appendChild(el("span", "bk-day-mon", chip.mon));
      if (has) {
        (function (dstr) {
          b2.addEventListener("click", function () {
            state.day = dstr; state.slot = null; state.notice = null; render(root);
          });
        })(dayStr);
      }
      days.appendChild(b2);
    }
    s2.appendChild(days);
    s2.appendChild(el("p", "bk-note", "Patient hours: Monday & Wednesday 9:30\u20135, Saturday 9\u20133. Need Tuesday, Thursday, Friday, or Sunday? Those run by appointment \u2014 call 773-857-2290."));
    box.appendChild(s2);
    if (!state.day) return;

    // Step 3 - time
    var s3 = el("div", "bk-step");
    s3.appendChild(el("p", "bk-step-label", "3 \u00b7 Pick a time \u2014 " + fmtDayLong(state.day)));
    if (state.notice) {
      var notice = el("p", "bk-error bk-notice", state.notice);
      notice.setAttribute("role", "alert");
      s3.appendChild(notice);
    }
    var slots = state.byDay[state.day] || [];
    if (!slots.length) {
      // Only reachable when a reload (after a 409) emptied the chosen day;
      // without this the notice says "pick another slot" over an empty list.
      s3.appendChild(el("p", "bk-note", "No other times are open on this day \u2014 pick another day above."));
    }
    var groups = { Morning: [], Afternoon: [] };
    slots.forEach(function (iso) { groups[hourInChicago(iso) < 12 ? "Morning" : "Afternoon"].push(iso); });
    Object.keys(groups).forEach(function (g) {
      if (!groups[g].length) return;
      s3.appendChild(el("p", "bk-group", g));
      var tp = el("div", "bk-pills");
      groups[g].forEach(function (iso) {
        var tb = el("button", "bk-pill bk-time", fmtTime(iso));
        tb.type = "button";
        tb.setAttribute("aria-pressed", state.slot === iso ? "true" : "false");
        tb.addEventListener("click", function () { state.slot = iso; state.notice = null; render(root); });
        tp.appendChild(tb);
      });
      s3.appendChild(tp);
    });
    box.appendChild(s3);
    if (!state.slot) return;

    // Step 4 - details
    var s4 = el("div", "bk-step");
    s4.appendChild(el("p", "bk-step-label", "4 \u00b7 Your details"));
    var summary = el("p", "bk-summary");
    summary.textContent = reasonById(state.reason).label + " \u2014 " + fmtDayLong(state.day) + " at " + fmtTime(state.slot);
    s4.appendChild(summary);

    var form = el("form", "bk-form");
    form.noValidate = false;
    form.innerHTML =
      '<label>First name<input name="firstName" autocomplete="given-name" required maxlength="100"></label>' +
      '<label>Last name<input name="lastName" autocomplete="family-name" required maxlength="100"></label>' +
      '<label>Phone<input name="phone" type="tel" autocomplete="tel" required maxlength="20"></label>' +
      '<label>Email (for your confirmation)<input name="email" type="email" autocomplete="email" maxlength="255"></label>' +
      '<fieldset class="bk-radio"><legend>Have you been here before?</legend>' +
      '<label><input type="radio" name="newPatient" value="yes" checked> I\u2019m new</label>' +
      '<label><input type="radio" name="newPatient" value="no"> Returning patient</label></fieldset>' +
      '<label class="bk-wide">Anything brief we should know? <span class="bk-hint">(please save health details for your visit)</span>' +
      '<input name="notes" maxlength="300"></label>' +
      '<fieldset class="bk-radio bk-consent"><legend>Texts from the practice</legend>' +
      '<label><input type="checkbox" name="smsConsent" checked> Text me appointment reminders and confirmations</label>' +
      '<label><input type="checkbox" name="marketingConsent"> Occasional offers and news by text or email (reply STOP anytime)</label></fieldset>' +
      '<div class="bk-actions"><button type="submit" class="btn btn-solid">Hold this time</button>' +
      '<span class="bk-note">The time is held the moment you submit; the front desk confirms every request.</span></div>' +
      '<p class="bk-error" role="alert" hidden></p>';
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submit(root, form);
    });
    s4.appendChild(form);
    box.appendChild(s4);
  }

  function submit(root, form) {
    var err = form.querySelector(".bk-error");
    err.hidden = true;
    state.notice = null;
    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Holding\u2026";

    // Snapshot the pick: step 1 stays clickable while the request is in
    // flight, and a reason click resets state.day, which the confirmation
    // card must not depend on.
    var picked = { reason: state.reason, day: state.day, slot: state.slot };
    var data = {
      reason: picked.reason,
      slotStart: picked.slot,
      firstName: form.firstName.value.trim(),
      lastName: form.lastName.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim() || undefined,
      newPatient: form.newPatient.value === "yes",
      notes: form.notes.value.trim() || undefined,
      smsConsent: form.smsConsent.checked,
      marketingConsent: form.marketingConsent.checked
    };

    if (DEMO) {
      setTimeout(function () {
        state.done = { startsAt: picked.slot, reason: picked.reason, day: picked.day, demo: true };
        render(root);
      }, 350);
      return;
    }

    fetch(API + "/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) {
      // Read the body as text and parse it ourselves so a non-JSON body
      // (a proxy error page, an empty 409) still reaches the status check.
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        return { ok: r.ok, status: r.status, body: j };
      });
    })
      .then(function (res) {
        var body = res.body || {};
        if (res.ok) {
          // A 2xx without a JSON object body is not a booking (a proxy or
          // parked page answering for the API); treat it like any failure.
          if (!res.body || typeof res.body !== "object" || Array.isArray(res.body)) {
            throw new Error("bad body");
          }
          // Show the server's time when it is a real timestamp; a missing or
          // malformed one falls back to the slot that was requested.
          state.done = {
            startsAt: isDateString(body.startsAt) ? body.startsAt : picked.slot,
            id: body.requestId,
            reason: picked.reason,
            day: picked.day
          };
          render(root);
        } else if (res.status === 409) {
          // The slot was taken between pick and submit. The availability
          // reload below re-renders the box and tears down this form, so
          // the message lives in state and renders under step 3.
          state.notice = (typeof body.error === "string" && body.error) ||
                         "That time was just taken \u2014 pick another slot";
          state.slot = null;
          loadAvailability(root, function () { render(root); });
        } else {
          throw new Error((res.body && res.body.error) || "request failed");
        }
      })
      .catch(function () {
        err.textContent = "Something went wrong on our end. Call 773-857-2290 and we\u2019ll book you by phone.";
        err.hidden = false;
        btn.disabled = false; btn.textContent = "Hold this time";
      });
  }

  function renderDone(box) {
    var c = el("div", "bk-confirm");
    c.appendChild(el("p", "bk-confirm-mark", "\u2713"));
    c.appendChild(el("h3", null, "Your time is held"));
    var done = state.done;
    var reason = reasonById(done.reason);
    var day = done.day || chicagoDateStr(new Date(done.startsAt));
    c.appendChild(el("p", null, (reason ? reason.label : "Your visit") + " \u2014 " + fmtDayLong(day) + " at " + fmtTime(done.startsAt) + "."));
    c.appendChild(el("p", null, "The front desk will reach out to confirm it. Bring prior X-rays if you have them, your medication list, and your insurance details."));
    if (state.done.demo) {
      c.appendChild(el("p", "bk-note", "Design preview \u2014 no request was sent."));
    } else if (state.done.id) {
      c.appendChild(el("p", "bk-note", "Reference: " + String(state.done.id).slice(0, 8).toUpperCase() + " \u00b7 Questions? 773-857-2290"));
    }
    var again = el("button", "bk-navbtn", "Book another time");
    again.type = "button";
    again.addEventListener("click", function () {
      state.done = null; state.slot = null; state.day = null; state.notice = null;
      loadAvailability(again.closest(".bk-root") || document.getElementById("bk-root"), function () {
        render(document.getElementById("bk-root"));
      });
    });
    c.appendChild(again);
    box.appendChild(c);
  }

  function renderOffline(box) {
    var c = el("div", "bk-confirm bk-offline");
    c.appendChild(el("h3", null, "Online scheduling is briefly unavailable"));
    c.appendChild(el("p", null, "Call 773-857-2290 and a person will book you directly \u2014 Monday & Wednesday 9:30\u20135, Saturday 9\u20133, other days by appointment."));
    var a = el("a", "btn btn-solid", "Call 773-857-2290");
    a.href = "tel:+17738572290";
    c.appendChild(a);
    box.appendChild(c);
  }

  function init() {
    var root = document.getElementById("bk-root");
    if (!root) return;
    // fresh state per page render (the preview re-renders the page on route change)
    state = { reason: null, offset: 0, day: null, slot: null, byDay: {}, loading: false, notice: null };
    root.innerHTML = "";
    root.className = "bk-root";
    render(root);
  }

  window.TBBooking = { init: init };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
