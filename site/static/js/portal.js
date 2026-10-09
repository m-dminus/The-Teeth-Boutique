/* The Teeth Boutique - patient portal.
   Runs against the practice's own service; no third-party identity provider.
   Config: window.TB_API_BASE (API origin), window.TB_STRIPE_PK (publishable
   key, enables in-portal payment). */
(function () {
  "use strict";

  var API = window.TB_API_BASE || "https://api.theteethboutique.com";
  var DEMO = !!window.TB_BOOKING_DEMO;
  var state = { view: "signin", tab: "overview", me: null, email: "" };

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
    return "$" + (cents / 100).toFixed(2);
  }
  function fmtDT(iso) {
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  }
  function fmtD(iso) {
    if (!iso) return "";
    // Plain dates (YYYY-MM-DD) are calendar dates - never shift them by timezone.
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso + "T12:00:00Z"));
    }
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
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
      api("/logout", "POST").then(function () { state.me = null; state.view = "signin"; render(root); });
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
      if (!r.ok) { list.textContent = "Could not load appointments."; return; }
      if (!r.body.appointments.length) { list.appendChild(el("p", "bk-note", "No appointments yet.")); return; }
      r.body.appointments.forEach(function (ap) {
        var row = el("div", "pt-row");
        row.appendChild(el("span", "pt-row-main", ap.reasonLabel + " \u2014 " + ap.when));
        row.appendChild(el("span", "pt-tag pt-tag-" + ap.status, ap.status.replace("_", " ")));
        list.appendChild(row);
      });
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
        thread.innerHTML = "";
        if (!r.ok) { thread.textContent = "Could not load messages."; return; }
        if (!r.body.messages.length) thread.appendChild(el("p", "bk-note", "No messages yet \u2014 say hello."));
        r.body.messages.forEach(function (m) {
          var b = el("div", "pt-msg pt-msg-" + m.sender);
          b.appendChild(el("p", "pt-msg-body", m.body));
          b.appendChild(el("p", "pt-msg-meta", (m.sender === "patient" ? "You" : (m.senderName || "The Teeth Boutique")) + " \u00b7 " + fmtDT(m.createdAt)));
          thread.appendChild(b);
        });
        thread.scrollTop = thread.scrollHeight;
        state.me.unreadMessages = 0;
      });
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (DEMO) { err.textContent = "Design preview \u2014 messaging runs on the deployed site."; err.hidden = false; return; }
      btn.disabled = true;
      api("/messages", "POST", { body: ta.value.trim() }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { err.textContent = r.body.error || "Could not send"; err.hidden = false; return; }
        err.hidden = true; ta.value = ""; load();
      });
    });
    load();
  }

  function tabBilling(body, root) {
    api("/billing").then(function (r) {
      if (!r.ok) {
        body.appendChild(el("p", "bk-note", r.body.message || "Billing appears here once your account is linked to your chart."));
        return;
      }
      var d = r.body;
      var grid = el("div", "pt-grid");
      grid.appendChild(statCard("Current balance", money(d.balanceCents),
        d.balanceCents > 0 ? "Pay below, by phone (773-857-2290), or at the desk. Payment plans and CareCredit are available \u2014 ask us." : "Nothing owed right now."));
      body.appendChild(grid);

      if (d.balanceCents > 0 && window.TB_STRIPE_PK && !DEMO) {
        body.appendChild(payBox(d.balanceCents, root));
      }

      section("Charges", d.charges, function (c) {
        return [ (c.description || "Charge") + (c.service_date ? " \u2014 " + fmtD(c.service_date) : ""), money(c.amount_cents) + " \u00b7 " + c.status ];
      });
      section("Payments", d.payments, function (p) {
        return [ fmtD(p.created_at) + (p.last_four ? " \u00b7 " + (p.card_brand || "card") + " \u00b7\u00b7\u00b7\u00b7" + p.last_four : ""), money(p.amount_cents) + " \u00b7 " + p.status ];
      });
      section("Insurance claims", d.claims, function (c) {
        return [ (c.claim_number || "Claim") + " \u2014 " + (c.insurance_provider || "") + " \u00b7 " + fmtD(c.service_date), money(c.claim_total_cents) + " \u00b7 " + c.status ];
      });

      function section(title, rows, map) {
        body.appendChild(el("h3", "pt-h3", title));
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
    });
  }

  function payBox(balanceCents, root) {
    var box = el("div", "pt-pay");
    box.appendChild(el("h3", "pt-h3", "Pay online"));
    var f = el("form", "bk-form");
    var amtLabel = el("label", "bk-wide", "Amount ($)");
    var amt = el("input");
    amt.type = "number"; amt.step = "0.01"; amt.min = "1"; amt.value = (balanceCents / 100).toFixed(2); amt.required = true;
    amtLabel.appendChild(amt);
    f.appendChild(amtLabel);
    var cardWrap = el("div", "bk-wide pt-card");
    f.appendChild(cardWrap);
    var actions = el("div", "bk-actions");
    var btn = el("button", "btn btn-solid", "Pay securely");
    btn.type = "submit";
    actions.appendChild(btn);
    actions.appendChild(el("span", "bk-note", "Card handled by the payment network in your browser \u2014 the practice never sees the number."));
    f.appendChild(actions);
    var err = el("p", "bk-error"); err.hidden = true; f.appendChild(err);
    box.appendChild(f);

    var stripeObj, cardEl;
    loadStripe(function (ok) {
      if (!ok) { box.hidden = true; return; }
      stripeObj = window.Stripe(window.TB_STRIPE_PK);
      cardEl = stripeObj.elements().create("card");
      cardEl.mount(cardWrap);
    });

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!stripeObj || !cardEl) return;
      var cents = Math.round(parseFloat(amt.value) * 100);
      btn.disabled = true; err.hidden = true;
      api("/pay/create-intent", "POST", { amountCents: cents }).then(function (r) {
        if (!r.ok) throw new Error(r.body.error || "Could not start the payment");
        return stripeObj.confirmCardPayment(r.body.clientSecret, { payment_method: { card: cardEl } })
          .then(function (result) {
            if (result.error) throw new Error(result.error.message);
            return api("/pay/confirm", "POST", { paymentIntentId: r.body.paymentIntentId });
          });
      }).then(function (r2) {
        if (!r2.ok) throw new Error(r2.body.error || "Payment record failed");
        state.tab = "billing"; render(root);
      }).catch(function (ex) {
        err.textContent = ex.message; err.hidden = false; btn.disabled = false;
      });
    });
    return box;
  }

  function loadStripe(cb) {
    if (window.Stripe) return cb(true);
    var s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = function () { cb(true); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  function tabRecords(body, root) {
    api("/records").then(function (r) {
      if (!r.ok) {
        body.appendChild(el("p", "bk-note", r.body.message || "Records appear here once your account is linked to your chart."));
        return;
      }
      var d = r.body;
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
        if (!v.ok || !v.body.visits.length) return;
        body.appendChild(el("h3", "pt-h3", "Visit history"));
        var vl = el("div", "pt-list");
        v.body.visits.forEach(function (vi) {
          var row = el("div", "pt-row");
          row.appendChild(el("span", "pt-row-main", fmtD(vi.visit_date) + " \u2014 " + (vi.visit_type || "visit") + (vi.treatment_code ? " (" + vi.treatment_code + ")" : "")));
          if (vi.patient_responsibility_cents != null) row.appendChild(el("span", "pt-row-side", money(vi.patient_responsibility_cents)));
          vl.appendChild(row);
        });
        body.appendChild(vl);
      });
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
    api("/preferences").then(function (r) {
      if (!r.ok) return;
      defs.forEach(function (d) { prefs[d[0]].checked = !!r.body[d[0]]; });
    });
    prefs.addEventListener("submit", function (e) {
      e.preventDefault();
      if (DEMO) { pmsg.textContent = "Design preview \u2014 preferences save on the deployed site."; return; }
      api("/preferences", "PUT", { smsReminders: prefs.smsReminders.checked, smsMarketing: prefs.smsMarketing.checked, emailMarketing: prefs.emailMarketing.checked })
        .then(function (r) { pmsg.textContent = r.ok ? "Saved." : (r.body.error || "Could not save"); });
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
      if (r.ok) { state.me = r.body; state.view = "app"; }
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
    state = { view: "signin", tab: "overview", me: null, email: "" };
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
