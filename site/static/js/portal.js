/* The Teeth Boutique - patient portal.
   Runs against the practice's own service; no third-party identity provider.
   Config: window.TB_API_BASE (API origin), window.TB_STRIPE_PK (publishable
   key, enables in-portal payment). */
(function () {
  "use strict";

  var API = window.TB_API_BASE || "https://api.theteethboutique.com";
  var DEMO = !!window.TB_BOOKING_DEMO;
  var state = { view: "signin", tab: "overview", me: null, email: "", paidCents: 0, payHold: null };

  // Shown on the Billing tab whenever online payment is not offered.
  var PAY_OFFLINE_TEXT = "Pay by phone (773-857-2290) or at the desk. Payment plans and CareCredit are available.";
  // Shown when a tab's data cannot be fetched (network failure or a non-409 error).
  var CALL_US = " \u2014 call 773-857-2290 and a person will help directly.";
  var BILLING_DOWN_TEXT = "Billing could not be loaded right now" + CALL_US;
  var RECORDS_DOWN_TEXT = "Records could not be loaded right now" + CALL_US;
  // Online payment needs at least $1.00 (the API rejects smaller intents).
  var MIN_PAY_CENTS = 100;
  // Shown (and the pay box withheld) from the moment Stripe has taken the
  // money until /pay/confirm records it; a second attempt would be a second
  // real charge. PENDING while the record request is still out, HOLD once it
  // has failed (or after a reload, when its outcome is unknown).
  var PAY_HOLD_TEXT = "Your card was charged, but the payment could not be recorded on your account. Do not pay again \u2014 call 773-857-2290 and we will sort it out.";
  var PAY_PENDING_TEXT = "Your card was charged and the payment is still being recorded on your account \u2014 do not pay again. If this note does not clear in a minute, call 773-857-2290.";
  var HOLD_KEY = "tb_portal_payhold"; // sessionStorage: the hold outlives a reload in this tab
  // js.stripe.com normally answers in well under a second; past this the
  // request has stalled (blocker that never fails, captive portal) and the
  // pay box falls back to phone/desk instead of loading forever.
  var STRIPE_LOAD_MS = 15000;

  // The Stripe publishable key, or "" unless window.TB_STRIPE_PK looks like a
  // real one. The placeholder shipped in the HTML ("pk_live_REPLACE_ME") and
  // demo/sample values keep the pay box - and the Stripe script - off the page.
  var keyWarned = false;
  function stripeKey() {
    var k = window.TB_STRIPE_PK;
    if (typeof k !== "string") return "";
    k = k.trim();
    if (/^pk_(live|test)_[A-Za-z0-9]{16,}$/.test(k) && !/replace|placeholder|demo|sample|example|changeme/i.test(k)) return k;
    if (k && !keyWarned && window.console && typeof console.warn === "function") {
      keyWarned = true; // diagnosable from the console, once, without echoing the value
      console.warn("Portal: window.TB_STRIPE_PK is not a usable Stripe publishable key, so online payment is off.");
    }
    return "";
  }

  function api(path, method, body) {
    return fetch(API + "/api/portal" + path, {
      method: method || "GET",
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { ok: r.ok, status: r.status, body: j };
      });
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function money(cents) {
    var n = Number(cents) || 0;
    return (n < 0 ? "-$" : "$") + (Math.abs(n) / 100).toFixed(2);
  }
  // Date helpers return "" for anything Date cannot parse, so one odd row
  // never throws a RangeError out of the middle of a render.
  function fmtDT(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
  }
  function fmtD(iso) {
    if (!iso) return "";
    var d;
    // Plain dates (YYYY-MM-DD) are calendar dates - never shift them by timezone.
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      d = new Date(iso + "T12:00:00Z");
      if (isNaN(d.getTime())) return "";
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(d);
    }
    d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" }).format(d);
  }

  // ---------------- shared form helpers ----------------
  function field(labelText, name, type, autocomplete) {
    var l = el("label", null, labelText);
    var i = el("input");
    i.name = name; i.type = type || "text";
    if (autocomplete) i.autocomplete = autocomplete;
    if (type !== "checkbox") i.required = true;
    l.appendChild(i);
    return l;
  }
  function formErr(form, msg) {
    var e = form.querySelector(".bk-error");
    e.textContent = msg || "";
    e.hidden = !msg;
  }
  function buildForm(fields, submitLabel, onSubmit, wideAll) {
    var f = el("form", "bk-form pt-authform");
    fields.forEach(function (x) { if (wideAll) x.classList.add("bk-wide"); f.appendChild(x); });
    var actions = el("div", "bk-actions");
    var btn = el("button", "btn btn-solid", submitLabel);
    btn.type = "submit";
    actions.appendChild(btn);
    f.appendChild(actions);
    var err = el("p", "bk-error");
    err.setAttribute("role", "alert"); err.hidden = true;
    f.appendChild(err);
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (DEMO) { formErr(f, "Design preview \u2014 the live portal runs on the deployed site."); return; }
      btn.disabled = true;
      Promise.resolve(onSubmit(f, btn))
        .catch(function () { formErr(f, "Something went wrong \u2014 try again or call 773-857-2290."); })
        .then(function () { btn.disabled = false; });
    });
    return f;
  }

  // ---------------- logged-out views ----------------
  function renderAuth(root) {
    var box = el("div", "pt-auth");
    var switcher = el("div", "bk-pills pt-switch");
    [["signin", "Sign in"], ["register", "Create account"]].forEach(function (v) {
      var b = el("button", "bk-pill", v[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", state.view === v[0] ? "true" : "false");
      b.addEventListener("click", function () { state.view = v[0]; render(root); });
      switcher.appendChild(b);
    });
    box.appendChild(switcher);

    if (state.view === "register") {
      box.appendChild(el("p", "bk-note", "Your account is created on the practice's own system. Your records attach once your email is verified and matches our chart for you \u2014 nothing clinical is shown before that."));
      box.appendChild(buildForm([
        field("First name", "firstName", "text", "given-name"),
        field("Last name", "lastName", "text", "family-name"),
        field("Email", "email", "email", "email"),
        (function(){ var l = field("Phone (optional)", "phone", "tel", "tel"); l.querySelector("input").required = false; return l; })(),
        field("Password (8+ characters)", "password", "password", "new-password"),
        (function(){
          var l = el("label", "bk-wide pt-check");
          var i = el("input"); i.type = "checkbox"; i.name = "marketingConsent";
          l.appendChild(i); l.appendChild(document.createTextNode(" Occasional offers and news from the practice by email or text (unsubscribe anytime)"));
          return l;
        })()
      ], "Create my account", function (f) {
        return api("/register", "POST", {
          firstName: f.firstName.value.trim(), lastName: f.lastName.value.trim(),
          email: f.email.value.trim(), phone: f.phone.value.trim() || undefined,
          password: f.password.value, marketingConsent: f.marketingConsent.checked
        }).then(function (r) {
          if (!r.ok) return formErr(f, r.body.error || "Could not create the account");
          state.email = f.email.value.trim();
          state.view = "verify";
          state.notice = r.body.message;
          render(root);
        });
      }));
    } else if (state.view === "verify") {
      box.appendChild(el("p", "bk-note", state.notice || "Enter the 6-digit code from your email."));
      var vf = buildForm([
        field("Email", "email", "email", "email"),
        field("6-digit code", "code", "text", "one-time-code")
      ], "Verify email", function (f) {
        return api("/verify", "POST", { email: f.email.value.trim(), code: f.code.value.trim() })
          .then(function (r) {
            if (!r.ok) return formErr(f, r.body.error || "Verification failed");
            state.view = "signin"; state.notice = "Verified \u2014 sign in below."; render(root);
          });
      }, true);
      vf.email.value = state.email || "";
      box.appendChild(vf);
      box.appendChild(linkRow(root, [["signin", "Back to sign in"]]));
    } else if (state.view === "forgot") {
      box.appendChild(el("p", "bk-note", "Enter your email \u2014 if it has an account, a reset code is sent to it."));
      box.appendChild(buildForm([field("Email", "email", "email", "email")], "Send reset code", function (f) {
        return api("/forgot", "POST", { email: f.email.value.trim() }).then(function (r) {
          state.email = f.email.value.trim();
          state.view = "reset"; state.notice = r.body.message; render(root);
        });
      }, true));
      box.appendChild(linkRow(root, [["signin", "Back to sign in"]]));
    } else if (state.view === "reset") {
      box.appendChild(el("p", "bk-note", state.notice || "Enter the code and a new password."));
      var rf = buildForm([
        field("Email", "email", "email", "email"),
        field("Reset code", "code", "text", "one-time-code"),
        field("New password (8+ characters)", "newPassword", "password", "new-password")
      ], "Set new password", function (f) {
        return api("/reset", "POST", { email: f.email.value.trim(), code: f.code.value.trim(), newPassword: f.newPassword.value })
          .then(function (r) {
            if (!r.ok) return formErr(f, r.body.error || "Reset failed");
            state.view = "signin"; state.notice = "Password changed \u2014 sign in."; render(root);
          });
      }, true);
      rf.email.value = state.email || "";
      box.appendChild(rf);
    } else { // signin
      if (state.notice) box.appendChild(el("p", "bk-note", state.notice));
      box.appendChild(buildForm([
        field("Email", "email", "email", "email"),
        field("Password", "password", "password", "current-password")
      ], "Sign in", function (f) {
        return api("/login", "POST", { email: f.email.value.trim(), password: f.password.value })
          .then(function (r) {
            if (!r.ok) return formErr(f, r.body.error || "Sign-in failed");
            state.notice = null;
            return loadMe(root);
          });
      }));
      box.appendChild(linkRow(root, [["forgot", "Forgot password?"], ["verify", "Have a verification code?"]]));
    }
    return box;
  }

  function linkRow(root, links) {
    var p = el("p", "pt-links");
    links.forEach(function (v) {
      var a = el("a", null, v[1]);
      a.href = "#";
      a.addEventListener("click", function (e) { e.preventDefault(); state.view = v[0]; render(root); });
      p.appendChild(a);
    });
    return p;
  }

  // ---------------- session + payment-hold helpers ----------------
  // A 401 after sign-in means the session is gone (expired, or revoked by a
  // password reset from another device): back to the sign-in form with a
  // note, instead of an outage message that sends the patient to the phone.
  // The state.view guard ignores a 401 that lands after a deliberate sign-out.
  function sessionGone(r, root) {
    if (!r || r.status !== 401 || state.view !== "app") return false;
    state.me = null; state.view = "signin"; state.notice = "Your session has expired \u2014 sign in again.";
    render(root);
    return true;
  }

  // Payment hold. state.payHold = { paymentIntentId, cents, accountId, failed }
  // is set the moment Stripe reports the card charged and cleared only once
  // /pay/confirm has answered 2xx. While it is set, every render shows the
  // hold note and Billing withholds the pay box, and the only action offered
  // re-sends the same payment reference (the API ignores a duplicate), so
  // nothing the patient can click creates a second charge. The hold is
  // mirrored to sessionStorage so a reload in this tab keeps it.
  var recordedIntents = {}; // intent ids whose record landed; a late duplicate answer is a no-op
  function readHold() {
    try {
      var h = JSON.parse(window.sessionStorage.getItem(HOLD_KEY));
      return h && typeof h === "object" && h.paymentIntentId ? h : null;
    } catch (e) { return null; }
  }
  function writeHold(h) {
    try {
      if (h) window.sessionStorage.setItem(HOLD_KEY, JSON.stringify(h));
      else window.sessionStorage.removeItem(HOLD_KEY);
    } catch (e) { /* storage blocked: the in-memory hold still applies */ }
  }
  function beginHold(paymentIntentId, cents) {
    var h = { paymentIntentId: paymentIntentId, cents: cents, failed: false,
              accountId: state.me && state.me.account ? state.me.account.id : null };
    state.payHold = h;
    writeHold(h);
    return h;
  }
  function holdFailed(h) {
    if (!h || recordedIntents[h.paymentIntentId]) return;
    h.failed = true;
    state.payHold = h;
    writeHold(h);
  }
  function holdText() { return state.payHold && state.payHold.failed ? PAY_HOLD_TEXT : PAY_PENDING_TEXT; }
  // Put (or update) the hold note in the live page, wherever the patient is now.
  function showHoldLive(root) {
    var box = root.querySelector(".pt-box");
    if (!box || !state.payHold) return;
    var note = box.querySelector(".pt-payhold");
    if (note) { note.querySelector(".pt-payhold-text").textContent = holdText(); return; }
    box.insertBefore(payHoldNote(root), box.firstChild);
  }
  function payHoldNote(root) {
    var n = el("div", "pt-banner pt-payhold");
    n.setAttribute("role", "alert");
    n.appendChild(el("p", "bk-error pt-payhold-text", holdText()));
    var row = el("p", "pt-payhold-actions");
    row.appendChild(retryRecordButton(root));
    n.appendChild(row);
    return n;
  }
  // "Record it again": POST /pay/confirm with the held intent id. Never a new
  // intent and never Stripe, so it cannot charge the card again.
  function retryRecordButton(root) {
    var wrap = el("span", "pt-payretry-wrap");
    var b = el("button", "bk-navbtn pt-payretry", "Try recording it again (no new charge)");
    b.type = "button";
    var st = el("span", "bk-note pt-payhold-status", "");
    b.addEventListener("click", function () {
      var h = state.payHold;
      if (!h || b.disabled) return;
      b.disabled = true; st.textContent = " Recording\u2026";
      api("/pay/confirm", "POST", { paymentIntentId: h.paymentIntentId }).then(function (r) {
        if (sessionGone(r, root)) return;
        var body = r.body || {};
        if (!r.ok) throw new Error(body.message || body.error || "Payment record failed");
        return recordPayment(h.paymentIntentId, Number(body.amountCents) || h.cents, root);
      }).catch(function () {
        b.disabled = false;
        st.textContent = " Still not recorded \u2014 try again in a moment, or call 773-857-2290.";
      });
    });
    wrap.appendChild(b); wrap.appendChild(st);
    return wrap;
  }
  // The record landed (first answer only): lift the hold, thank the patient
  // on Billing and refresh /me so the Overview balance is current. Billing is
  // re-rendered either way (its own fetch reports any outage).
  function recordPayment(paymentIntentId, cents, root) {
    if (recordedIntents[paymentIntentId]) return Promise.resolve();
    recordedIntents[paymentIntentId] = true;
    if (state.payHold && state.payHold.paymentIntentId === paymentIntentId) state.payHold = null;
    var stored = readHold();
    if (stored && stored.paymentIntentId === paymentIntentId) writeHold(null);
    state.paidCents = cents;
    state.tab = "billing";
    return api("/me").then(function (m) {
      if (m.ok && m.body && m.body.account) state.me = m.body;
    }).catch(function () {}).then(function () { render(root); });
  }

  // ---------------- logged-in app ----------------
  var TABS = [
    ["overview", "Overview"], ["appointments", "Appointments"], ["messages", "Messages"],
    ["billing", "Billing"], ["records", "My records"], ["account", "Account"]
  ];

  function renderApp(root) {
    var wrap = el("div", "pt-app");
    var head = el("div", "pt-head");
    head.appendChild(el("p", "pt-hello", "Signed in as " + state.me.account.firstName + " " + state.me.account.lastName));
    var out = el("button", "bk-navbtn", "Sign out");
    out.type = "button";
    out.addEventListener("click", function () {
      out.disabled = true;
      // 200, or 401 for a session that is already gone, means the session is
      // over. A 5xx means the server never revoked it (requirePatient fails
      // before the revoke and before clearCookie), so that is a failure just
      // like an unreachable API: the patient stays signed in and is told.
      api("/logout", "POST").then(function (r) { return r.ok || r.status === 401 ? "done" : "error"; }, function () { return "unreachable"; }).then(function (res) {
        if (res === "done") { state.me = null; state.view = "signin"; state.notice = null; render(root); return; }
        out.disabled = false;
        // A tab click meanwhile replaces the header: write the note into
        // whichever app wrapper is live, not into a detached one.
        var live = root.contains(wrap) ? wrap : (root.querySelector(".pt-app") || wrap);
        var liveHead = live.querySelector(".pt-head");
        var note = live.querySelector(".pt-signout-err");
        if (!note) {
          note = el("p", "bk-error pt-signout-err");
          note.setAttribute("role", "alert");
          live.insertBefore(note, liveHead ? liveHead.nextSibling : live.firstChild);
        }
        note.textContent = res === "unreachable"
          ? "Sign-out did not go through \u2014 the practice's system could not be reached. Try again in a moment."
          : "Sign-out did not go through \u2014 the practice's system reported a problem. Try again in a moment.";
      });
    });
    head.appendChild(out);
    wrap.appendChild(head);

    if (!state.me.account.linked) {
      wrap.appendChild(el("p", "pt-banner", "Your account isn't linked to your chart yet \u2014 it links automatically once your verified email matches our records, or the front desk links it at your visit (773-857-2290). Messages and booking work in the meantime."));
    }

    var tabs = el("div", "bk-pills pt-tabs");
    TABS.forEach(function (t) {
      var b = el("button", "bk-pill", t[1] + (t[0] === "messages" && state.me.unreadMessages ? " (" + state.me.unreadMessages + ")" : ""));
      b.type = "button";
      b.setAttribute("aria-pressed", state.tab === t[0] ? "true" : "false");
      b.addEventListener("click", function () { state.tab = t[0]; render(root); });
      tabs.appendChild(b);
    });
    wrap.appendChild(tabs);

    var body = el("div", "pt-body");
    wrap.appendChild(body);
    var fn = { overview: tabOverview, appointments: tabAppointments, messages: tabMessages,
               billing: tabBilling, records: tabRecords, account: tabAccount }[state.tab];
    fn(body, root);
    return wrap;
  }

  function statCard(label, value, sub) {
    var c = el("div", "pt-stat");
    c.appendChild(el("p", "pt-stat-label", label));
    c.appendChild(el("p", "pt-stat-value", value));
    if (sub) c.appendChild(el("p", "bk-note", sub));
    return c;
  }

  function tabOverview(body, root) {
    var grid = el("div", "pt-grid");
    var me = state.me;
    grid.appendChild(statCard("Next appointment",
      me.nextAppointment ? me.nextAppointment.when : "None booked",
      me.nextAppointment ? me.nextAppointment.reason + " \u2014 " + (me.nextAppointment.status === "confirmed" ? "confirmed" : "held, awaiting confirmation") : "Book from the Book Online page \u2014 visits under this email appear here."));
    grid.appendChild(statCard("Balance", money(me.balanceCents),
      me.balanceCents > 0 ? "Open in Billing to review or pay." : "Nothing owed right now."));
    grid.appendChild(statCard("Messages", me.unreadMessages ? me.unreadMessages + " unread" : "No unread",
      "Secure two-way messages with the front desk."));
    body.appendChild(grid);
  }

  function tabAppointments(body, root) {
    body.appendChild(el("p", "bk-note", "Times shown in Chicago time. Book new visits on the Book Online page \u2014 anything booked with your verified email shows here automatically."));
    var a = el("a", "btn btn-solid", "Book Online");
    a.href = "/book/";
    body.appendChild(a);
    var list = el("div", "pt-list");
    body.appendChild(list);
    api("/appointments").then(function (r) {
      if (sessionGone(r, root)) return;
      var aps = r.ok && r.body && Array.isArray(r.body.appointments) ? r.body.appointments : null;
      if (!aps) { list.textContent = "Could not load appointments."; return; }
      if (!aps.length) { list.appendChild(el("p", "bk-note", "No appointments yet.")); return; }
      aps.forEach(function (ap) {
        if (!ap || typeof ap !== "object") return;
        var status = String(ap.status || "");
        var row = el("div", "pt-row");
        row.appendChild(el("span", "pt-row-main", (ap.reasonLabel || "Visit") + " \u2014 " + (ap.when || "")));
        row.appendChild(el("span", "pt-tag pt-tag-" + status, status.replace("_", " ")));
        list.appendChild(row);
      });
    }).catch(function () {
      list.textContent = "Could not load appointments.";
    });
  }

  function tabMessages(body, root) {
    var thread = el("div", "pt-thread");
    body.appendChild(thread);
    var form = el("form", "pt-compose");
    var ta = el("textarea");
    ta.maxLength = 2000;
    ta.placeholder = "Write to the front desk \u2014 scheduling, billing, questions. For emergencies call 773-857-2290.";
    ta.required = true;
    form.appendChild(ta);
    var btn = el("button", "btn btn-solid", "Send");
    btn.type = "submit";
    form.appendChild(btn);
    var err = el("p", "bk-error"); err.hidden = true; form.appendChild(err);
    body.appendChild(form);

    function load() {
      api("/messages").then(function (r) {
        if (sessionGone(r, root)) return;
        thread.innerHTML = "";
        var msgs = r.ok && r.body && Array.isArray(r.body.messages) ? r.body.messages : null;
        if (!msgs) { thread.textContent = "Could not load messages."; return; }
        if (!msgs.length) thread.appendChild(el("p", "bk-note", "No messages yet \u2014 say hello."));
        msgs.forEach(function (m) {
          if (!m || typeof m !== "object") return;
          var b = el("div", "pt-msg pt-msg-" + (m.sender || "staff"));
          b.appendChild(el("p", "pt-msg-body", m.body == null ? "" : String(m.body)));
          b.appendChild(el("p", "pt-msg-meta", (m.sender === "patient" ? "You" : (m.senderName || "The Teeth Boutique")) + " \u00b7 " + fmtDT(m.createdAt)));
          thread.appendChild(b);
        });
        thread.scrollTop = thread.scrollHeight;
        if (state.me) state.me.unreadMessages = 0;
      }).catch(function () {
        thread.textContent = "Could not load messages.";
      });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (DEMO) { err.textContent = "Design preview \u2014 messaging runs on the deployed site."; err.hidden = false; return; }
      btn.disabled = true;
      api("/messages", "POST", { body: ta.value.trim() }).then(function (r) {
        if (sessionGone(r, root)) return;
        btn.disabled = false;
        if (!r.ok) { err.textContent = (r.body && r.body.error) || "Could not send"; err.hidden = false; return; }
        err.hidden = true; ta.value = ""; load();
      }).catch(function () {
        btn.disabled = false;
        err.textContent = "Could not send \u2014 try again or call 773-857-2290."; err.hidden = false;
      });
    });
    load();
  }

  function tabBilling(body, root) {
    var paid = state.paidCents;
    if (paid) {
      // Set by a payment that just went through; shown on this render and
      // cleared once its fetch settles (a Billing re-click while it pends
      // shows it again rather than losing it).
      body.appendChild(el("p", "pt-banner", "Payment of " + money(paid) + " received \u2014 thank you."));
    }
    var loading = el("p", "bk-note pt-loading", "Loading billing\u2026");
    body.appendChild(loading);
    function done() {
      if (loading.parentNode) loading.parentNode.removeChild(loading);
      if (paid && state.paidCents === paid) state.paidCents = 0;
    }
    api("/billing").then(function (r) {
      done();
      if (sessionGone(r, root)) return;
      if (!r.ok) {
        // Only 409 is the "not linked yet" case (requireLinked); anything else
        // is an outage or an expired session, never a linking problem.
        var eb = r.body || {};
        body.appendChild(el("p", "bk-note", r.status === 409
          ? (eb.message || "Billing appears here once your account is linked to your chart.")
          : BILLING_DOWN_TEXT));
        return;
      }
      var d = r.body || {};
      var balance = Number(d.balanceCents) || 0;
      var key = stripeKey();
      // Online payment only with a real publishable key, a balance of at least
      // $1.00 (the API minimum), outside the design preview and with no
      // charged-but-unrecorded payment on hold; everything else points at
      // phone/desk (or at the hold note above).
      var held = !!state.payHold;
      var canPay = balance >= MIN_PAY_CENTS && !DEMO && !!key && !held;
      var grid = el("div", "pt-grid");
      var balCard = statCard("Current balance", money(balance),
        held ? "See the note above before paying anything." : balance > 0
          ? (canPay ? "Pay below, by phone (773-857-2290), or at the desk. Payment plans and CareCredit are available \u2014 ask us." : PAY_OFFLINE_TEXT)
          : "Nothing owed right now.");
      grid.appendChild(balCard);
      body.appendChild(grid);

      if (canPay) {
        body.appendChild(payBox(balance, key, root, balCard.querySelector(".bk-note")));
      }

      section("Charges", d.charges, function (c) {
        var when = fmtD(c.service_date);
        return [ (c.description || "Charge") + (when ? " \u2014 " + when : ""), money(c.amount_cents) + " \u00b7 " + (c.status || "") ];
      });
      section("Payments", d.payments, function (p) {
        return [ fmtD(p.created_at) + (p.last_four ? " \u00b7 " + (p.card_brand || "card") + " \u00b7\u00b7\u00b7\u00b7" + p.last_four : ""), money(p.amount_cents) + " \u00b7 " + (p.status || "") ];
      });
      section("Insurance claims", d.claims, function (c) {
        return [ (c.claim_number || "Claim") + " \u2014 " + (c.insurance_provider || "") + " \u00b7 " + fmtD(c.service_date), money(c.claim_total_cents) + " \u00b7 " + (c.status || "") ];
      });

      function section(title, rows, map) {
        body.appendChild(el("h3", "pt-h3", title));
        rows = Array.isArray(rows) ? rows.filter(function (x) { return x && typeof x === "object"; }) : [];
        if (!rows.length) { body.appendChild(el("p", "bk-note", "None on file.")); return; }
        var list = el("div", "pt-list");
        rows.forEach(function (x) {
          var pair = map(x);
          var row = el("div", "pt-row");
          row.appendChild(el("span", "pt-row-main", pair[0]));
          row.appendChild(el("span", "pt-row-side", pair[1]));
          list.appendChild(row);
        });
        body.appendChild(list);
      }
    }).catch(function () {
      done();
      body.appendChild(el("p", "bk-note", BILLING_DOWN_TEXT));
    });
  }

  // cardNote: the balance card's sub-text, rewritten if Stripe turns out to be
  // unavailable so it no longer says "Pay below".
  function payBox(balanceCents, key, root, cardNote) {
    var box = el("div", "pt-pay");
    box.appendChild(el("h3", "pt-h3", "Pay online"));
    var f = el("form", "bk-form");
    // At most the balance: a slipped decimal point (12345.00 for $123.45)
    // must not become a $12,345 charge, which the API would accept.
    var maxCents = Math.round(balanceCents);
    var amtLabel = el("label", "bk-wide", "Amount ($)");
    var amt = el("input");
    amt.type = "number"; amt.step = "0.01"; amt.min = "1"; amt.max = (maxCents / 100).toFixed(2);
    amt.value = (maxCents / 100).toFixed(2); amt.required = true;
    amtLabel.appendChild(amt);
    f.appendChild(amtLabel);
    var cardWrap = el("div", "bk-wide pt-card", "Loading the secure card form\u2026");
    f.appendChild(cardWrap);
    var actions = el("div", "bk-actions");
    var btn = el("button", "btn btn-solid", "Pay securely");
    btn.type = "submit";
    btn.disabled = true; // until Stripe has mounted the card element
    actions.appendChild(btn);
    actions.appendChild(el("span", "bk-note", "Card handled by the payment network in your browser \u2014 the practice never sees the number."));
    f.appendChild(actions);
    var note = el("p", "bk-note pt-paynote"); note.hidden = true; note.style.gridColumn = "1 / -1"; f.appendChild(note);
    var err = el("p", "bk-error"); err.hidden = true; f.appendChild(err);
    box.appendChild(f);

    var stripeObj, cardEl;
    function unavailable() {
      stripeObj = null; cardEl = null;
      f.hidden = true;
      f.style.display = "none"; // .bk-form sets display:grid, which would beat [hidden]
      if (cardNote) cardNote.textContent = PAY_OFFLINE_TEXT;
      box.appendChild(el("p", "bk-note", "Online payment is unavailable right now. " + PAY_OFFLINE_TEXT));
    }
    loadStripe(function (ok) {
      if (!ok || typeof window.Stripe !== "function") { unavailable(); return; }
      try {
        stripeObj = window.Stripe(key);
        cardEl = stripeObj.elements().create("card");
        cardWrap.textContent = "";
        cardEl.mount(cardWrap);
        btn.disabled = false;
      } catch (ex) {
        unavailable();
      }
    });

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!stripeObj || !cardEl) {
        // Stripe.js has not mounted the card yet: the button is disabled, so
        // only a forced submit gets here; say so rather than doing nothing.
        if (!f.hidden) { err.textContent = "The card form is still loading \u2014 give it a moment and try again."; err.hidden = false; }
        return;
      }
      if (btn.disabled) return;
      var cents = Math.round(parseFloat(amt.value) * 100);
      if (!(cents >= MIN_PAY_CENTS) || cents > maxCents) {
        err.textContent = "Enter an amount between $1.00 and " + money(maxCents) + "."; err.hidden = false;
        return;
      }
      var hold = null; // set once Stripe has taken the money
      btn.disabled = true; err.hidden = true;
      api("/pay/create-intent", "POST", { amountCents: cents }).then(function (r) {
        if (sessionGone(r, root)) return null;
        var b = r.body || {};
        if (!r.ok) throw new Error(b.message || b.error || "Could not start the payment");
        if (!b.clientSecret || !b.paymentIntentId) throw new Error("Could not start the payment");
        return stripeObj.confirmCardPayment(b.clientSecret, { payment_method: { card: cardEl } })
          .then(function (result) {
            if (!result || result.error) throw new Error((result && result.error && result.error.message) || "The card was not charged");
            hold = beginHold(b.paymentIntentId, cents);
            note.textContent = "Card charged \u2014 recording the payment on your account\u2026"; note.hidden = false;
            return api("/pay/confirm", "POST", { paymentIntentId: b.paymentIntentId });
          });
      }).then(function (r2) {
        if (r2 === null) return; // signed out meanwhile
        var b2 = r2.body || {};
        if (!r2.ok) throw new Error(b2.message || b2.error || "Payment record failed");
        return recordPayment(hold.paymentIntentId, Number(b2.amountCents) || cents, root);
      }).catch(function (ex) {
        var msg = ex && ex.message;
        note.hidden = true;
        if (hold) {
          // The card was charged but the record did not land: a new attempt
          // would be a second charge, so the Pay button stays off (here and,
          // through state.payHold, on every later render); the only action
          // offered re-sends the same payment reference.
          holdFailed(hold);
          if (recordedIntents[hold.paymentIntentId]) return; // a duplicate answer landed first
          msg = PAY_HOLD_TEXT;
          if (root.contains(box)) {
            if (!actions.querySelector(".pt-payretry")) actions.appendChild(retryRecordButton(root));
          } else {
            showHoldLive(root); // the patient has moved on: the note goes where they are
          }
        } else {
          if (!msg || ex instanceof TypeError) msg = "The payment could not be completed right now \u2014 call 773-857-2290 before trying again.";
          btn.disabled = false;
        }
        err.textContent = msg; err.hidden = false;
      });
    });
    return box;
  }

  var stripeWaiters = null; // callbacks queued while js.stripe.com is loading
  function loadStripe(cb) {
    if (window.Stripe) return cb(true);
    if (stripeWaiters) { stripeWaiters.push(cb); return; } // one script tag per load
    stripeWaiters = [cb];
    var timer = null;
    function settle(ok) {
      if (timer) { clearTimeout(timer); timer = null; }
      var list = stripeWaiters || [];
      stripeWaiters = null; // a failed load may be retried on the next render
      list.forEach(function (fn) { fn(ok); });
    }
    var s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = function () { settle(true); };
    s.onerror = function () { settle(false); };
    // A request that never settles would leave the card form "loading" for
    // good; give up after STRIPE_LOAD_MS (a late load still defines
    // window.Stripe, which the next Billing render picks up).
    timer = setTimeout(function () { timer = null; settle(false); }, STRIPE_LOAD_MS);
    document.head.appendChild(s);
  }

  function tabRecords(body, root) {
    api("/records").then(function (r) {
      if (sessionGone(r, root)) return;
      if (!r.ok) {
        var eb = r.body || {};
        body.appendChild(el("p", "bk-note", r.status === 409
          ? (eb.message || "Records appear here once your account is linked to your chart.")
          : RECORDS_DOWN_TEXT));
        return;
      }
      var d = r.body || {};
      var rows = [
        ["Name", (d.firstName || "") + " " + (d.lastName || "")],
        ["Date of birth", fmtD(d.dateOfBirth)],
        ["Phone", d.phone || ""], ["Email", d.email || ""],
        ["Address", [d.streetAddress, d.city, d.state, d.postalCode].filter(Boolean).join(", ")],
        ["Medical conditions", d.medicalConditions || "None on file"],
        ["Allergies", d.allergies || "None on file"],
        ["Current medications", d.currentMedications || "None on file"],
        ["Insurance", [d.insuranceProvider, d.insurancePolicyId && "ID " + d.insurancePolicyId, d.insuranceGroupId && "Group " + d.insuranceGroupId].filter(Boolean).join(" \u00b7 ") || "None on file"],
      ];
      var list = el("div", "pt-list");
      rows.forEach(function (x) {
        var row = el("div", "pt-row");
        row.appendChild(el("span", "pt-row-label", x[0]));
        row.appendChild(el("span", "pt-row-main", x[1]));
        list.appendChild(row);
      });
      body.appendChild(list);
      body.appendChild(el("p", "bk-note", "Something out of date? Send us a message or tell the front desk at your next visit \u2014 corrections are made on the chart, and this view follows it."));
      api("/visits").then(function (v) {
        if (sessionGone(v, root)) return;
        var visits = v.ok && v.body && Array.isArray(v.body.visits) ? v.body.visits.filter(function (x) { return x && typeof x === "object"; }) : [];
        if (!visits.length) return;
        body.appendChild(el("h3", "pt-h3", "Visit history"));
        var vl = el("div", "pt-list");
        visits.forEach(function (vi) {
          var row = el("div", "pt-row");
          row.appendChild(el("span", "pt-row-main", fmtD(vi.visit_date) + " \u2014 " + (vi.visit_type || "visit") + (vi.treatment_code ? " (" + vi.treatment_code + ")" : "")));
          if (vi.patient_responsibility_cents != null) row.appendChild(el("span", "pt-row-side", money(vi.patient_responsibility_cents)));
          vl.appendChild(row);
        });
        body.appendChild(vl);
      }).catch(function () {}); // visit history is optional on this tab
    }).catch(function () {
      body.appendChild(el("p", "bk-note", RECORDS_DOWN_TEXT));
    });
  }

  function tabAccount(body, root) {
    body.appendChild(el("h3", "pt-h3", "How we may contact you"));
    var prefs = el("form", "pt-prefs");
    var defs = [["smsReminders", "Text me appointment reminders and confirmations"],
                ["smsMarketing", "Occasional offers and news by text"],
                ["emailMarketing", "Occasional offers and news by email"]];
    defs.forEach(function (d) {
      var l = el("label", "pt-check");
      var i = el("input"); i.type = "checkbox"; i.name = d[0];
      l.appendChild(i); l.appendChild(document.createTextNode(" " + d[1]));
      prefs.appendChild(l);
    });
    var saveBtn = el("button", "btn btn-solid", "Save preferences"); saveBtn.type = "submit";
    prefs.appendChild(saveBtn);
    var pmsg = el("p", "bk-note", ""); prefs.appendChild(pmsg);
    body.appendChild(prefs);
    var PREFS_LOAD_TEXT = "Your saved preferences could not be loaded right now \u2014 reload the page before making changes.";
    api("/preferences").then(function (r) {
      if (sessionGone(r, root)) return;
      if (!r.ok || !r.body || typeof r.body !== "object" || Array.isArray(r.body)) { pmsg.textContent = PREFS_LOAD_TEXT; return; }
      defs.forEach(function (d) { prefs[d[0]].checked = !!r.body[d[0]]; });
    }).catch(function () {
      pmsg.textContent = PREFS_LOAD_TEXT;
    });
    prefs.addEventListener("submit", function (e) {
      e.preventDefault();
      if (DEMO) { pmsg.textContent = "Design preview \u2014 preferences save on the deployed site."; return; }
      saveBtn.disabled = true;
      api("/preferences", "PUT", { smsReminders: prefs.smsReminders.checked, smsMarketing: prefs.smsMarketing.checked, emailMarketing: prefs.emailMarketing.checked })
        .then(function (r) { if (sessionGone(r, root)) return; pmsg.textContent = r.ok ? "Saved." : ((r.body && r.body.error) || "Could not save"); })
        .catch(function () { pmsg.textContent = "Could not save \u2014 try again or call 773-857-2290."; })
        .then(function () { saveBtn.disabled = false; });
    });

    body.appendChild(el("h3", "pt-h3", "Change password"));
    body.appendChild(buildForm([
      field("Current password", "currentPassword", "password", "current-password"),
      field("New password (8+ characters)", "newPassword", "password", "new-password")
    ], "Change password", function (f) {
      return api("/change-password", "POST", { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value })
        .then(function (r) {
          formErr(f, r.ok ? "" : (r.body.error || "Could not change the password"));
          if (r.ok) { f.reset(); f.querySelector(".bk-error").hidden = false; f.querySelector(".bk-error").textContent = "Password changed. Other signed-in devices were signed out."; }
        });
    }));
    body.appendChild(el("h3", "pt-h3", "Your data"));
    body.appendChild(el("p", "bk-note", "Your records live on the practice's own systems and follow the practice's retention rules. To request a copy or deletion, send us a message from the Messages tab or call 773-857-2290 \u2014 the records-release form on the Forms page moves records wherever you need them."));
  }

  // ---------------- boot ----------------
  function loadMe(root) {
    return api("/me").then(function (r) {
      if (r.ok) {
        state.me = r.body; state.view = "app";
        // A hold from this tab (card charged, record not confirmed) outlives
        // a reload; its outcome is unknown now, so it reads as failed and the
        // "record it again" action settles it either way.
        var h = readHold();
        if (h && !state.payHold && r.body && r.body.account && h.accountId === r.body.account.id) { h.failed = true; state.payHold = h; }
      }
      else if (state.view === "app") { state.view = "signin"; }
      render(root);
    }).catch(function () {
      state.offline = true;
      render(root);
    });
  }

  function render(root) {
    var box = root.querySelector(".pt-box") || root.appendChild(el("div", "pt-box"));
    box.innerHTML = "";
    if (DEMO) box.appendChild(el("p", "pt-banner", "Design preview \u2014 the live portal signs in against the practice's own service on the deployed site."));
    // The hold note sits above whichever view is shown (every tab, and the
    // sign-in form if the session ends meanwhile) until the record lands.
    if (state.payHold && !DEMO) box.appendChild(payHoldNote(root));
    if (state.offline && !DEMO) {
      var c = el("div", "bk-confirm bk-offline");
      c.appendChild(el("h3", null, "The portal is briefly unavailable"));
      c.appendChild(el("p", null, "Call 773-857-2290 and a person will help directly."));
      box.appendChild(c);
      return;
    }
    box.appendChild(state.view === "app" && state.me ? renderApp(root) : renderAuth(root));
  }

  function init() {
    var root = document.getElementById("pt-root");
    if (!root) return;
    root.innerHTML = "";
    root.className = "pt-root";
    state = { view: "signin", tab: "overview", me: null, email: "", paidCents: 0, payHold: null };
    if (DEMO) { render(root); return; }
    render(root);
    loadMe(root);
  }

  window.TBPortal = { init: init };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
