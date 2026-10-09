/* The Teeth Boutique - staff console (replaces the vendor desktop app).
   Talks to the practice's own API with the staff token; nothing here is
   public - the page is noindex and the token gates every call. */
(function () {
  "use strict";

  var API = window.TB_API_BASE || "https://api.theteethboutique.com";
  var DEMO = !!window.TB_BOOKING_DEMO;
  var TZ = "America/Chicago";
  var TABS = [["today", "Today"], ["inbox", "Inbox"], ["contacts", "Contacts"], ["accounts", "Portal accounts"],
              ["campaigns", "Campaigns"], ["log", "Message log"]];
  var state = { token: null, tab: "today" };

  try { state.token = sessionStorage.getItem("tb_staff_token"); } catch (e) {}

  function api(path, method, body) {
    return fetch(API + "/api" + path, {
      method: method || "GET",
      headers: Object.assign({ Authorization: "Bearer " + (state.token || "") }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    });
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(label, cls, fn) { var b = el("button", cls || "bk-navbtn", label); b.type = "button"; b.addEventListener("click", fn); return b; }
  function fmtDT(iso) { return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); }
  function fmtD(iso) {
    if (!iso) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso + "T12:00:00Z"));
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
  }
  function money(c) { return "$" + (c / 100).toFixed(2); }
  function note(parent, text, cls) { parent.appendChild(el("p", cls || "bk-note", text)); }
  function row(main, side, extra) {
    var r = el("div", "pt-row");
    r.appendChild(el("span", "pt-row-main", main));
    if (side != null) r.appendChild(el("span", "pt-row-side", side));
    if (extra) r.appendChild(extra);
    return r;
  }
  function input(name, placeholder, type) { var i = el("input"); i.name = name; i.placeholder = placeholder; i.type = type || "text"; return i; }

  // ---------------- login ----------------
  function renderLogin(root, msg) {
    var box = el("div", "pt-auth");
    if (DEMO) note(box, "Design preview \u2014 the live console signs in against the practice's own service on the deployed site.", "pt-banner");
    note(box, "Enter the staff access token (the ADMIN_API_TOKEN configured on the server). It stays in this browser tab only.");
    var f = el("form", "bk-form");
    var l = el("label", "bk-wide", "Staff token"); var i = input("token", "", "password"); i.required = true; l.appendChild(i); f.appendChild(l);
    var a = el("div", "bk-actions"); var s = el("button", "btn btn-solid", "Open console"); s.type = "submit"; a.appendChild(s); f.appendChild(a);
    var err = el("p", "bk-error"); err.hidden = !msg; err.textContent = msg || ""; f.appendChild(err);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (DEMO) { err.textContent = "Design preview \u2014 no live service in this file."; err.hidden = false; return; }
      state.token = i.value.trim();
      api("/comms/stats").then(function (r) {
        if (!r.ok) { state.token = null; err.textContent = r.status === 401 ? "That token was not accepted." : (r.body.error || "Could not reach the service"); err.hidden = false; return; }
        try { sessionStorage.setItem("tb_staff_token", state.token); } catch (x) {}
        render(root);
      });
    });
    box.appendChild(f);
    return box;
  }

  // ---------------- shell ----------------
  function renderApp(root) {
    var wrap = el("div", "pt-app");
    var head = el("div", "pt-head");
    head.appendChild(el("p", "pt-hello", "Front desk console"));
    head.appendChild(btn("Sign out", null, function () { state.token = null; try { sessionStorage.removeItem("tb_staff_token"); } catch (e) {} render(root); }));
    wrap.appendChild(head);
    var tabs = el("div", "bk-pills pt-tabs");
    TABS.forEach(function (t) {
      var b = btn(t[1], "bk-pill", function () { state.tab = t[0]; render(root); });
      b.setAttribute("aria-pressed", state.tab === t[0] ? "true" : "false");
      tabs.appendChild(b);
    });
    wrap.appendChild(tabs);
    var body = el("div", "pt-body"); wrap.appendChild(body);
    ({ today: tabToday, inbox: tabInbox, contacts: tabContacts, accounts: tabAccounts, campaigns: tabCampaigns, log: tabLog })[state.tab](body, root);
    return wrap;
  }

  function stat(label, value, sub) { var c = el("div", "pt-stat"); c.appendChild(el("p", "pt-stat-label", label)); c.appendChild(el("p", "pt-stat-value", String(value))); if (sub) note(c, sub); return c; }

  // ---------------- today ----------------
  function tabToday(body, root) {
    var grid = el("div", "pt-grid"); body.appendChild(grid);
    api("/comms/stats").then(function (r) {
      if (!r.ok) return note(body, "Could not load stats.");
      var s = r.body;
      grid.appendChild(stat("Next 7 days", (s.next7days.confirmed || 0) + " confirmed \u00b7 " + (s.next7days.requested || 0) + " awaiting"));
      grid.appendChild(stat("Waiting on you", (s.openTexts + s.unreadPortalMessages) + " messages", s.openTexts + " texts \u00b7 " + s.unreadPortalMessages + " portal"));
      grid.appendChild(stat("Contacts", s.contacts.total, s.contacts.sms_marketing + " text marketing \u00b7 " + s.contacts.email_marketing + " email \u00b7 " + s.contacts.recall_due + " recall due"));
    });

    body.appendChild(el("h3", "pt-h3", "The book \u2014 next 7 days"));
    var list = el("div", "pt-list"); body.appendChild(list);
    var today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    var to = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    api("/appointments?from=" + today + "&to=" + to).then(function (r) {
      if (!r.ok) return note(list, "Could not load the book.");
      if (!r.body.appointments.length) return note(list, "Nothing booked in the next 7 days.");
      r.body.appointments.forEach(function (a) {
        var actions = el("span", "st-actions");
        function setStatus(st) { api("/appointments/" + a.id, "PUT", { status: st }).then(function () { render(root); }); }
        if (a.status === "requested") actions.appendChild(btn("Confirm", "bk-navbtn", function () { setStatus("confirmed"); }));
        if (a.status === "requested" || a.status === "confirmed") actions.appendChild(btn("Decline", "bk-navbtn", function () { setStatus("declined"); }));
        if (a.status === "confirmed") { actions.appendChild(btn("Completed", "bk-navbtn", function () { setStatus("completed"); })); actions.appendChild(btn("No-show", "bk-navbtn", function () { setStatus("no_show"); })); }
        var main = fmtDT(a.starts_at) + " \u2014 " + a.first_name + " " + a.last_name + " \u00b7 " + a.reason + (a.new_patient ? " \u00b7 new" : "") + " \u00b7 " + a.phone + (a.notes ? " \u00b7 \u201c" + a.notes + "\u201d" : "");
        var rr = row(main, null, actions);
        var tag = el("span", "pt-tag pt-tag-" + a.status, a.status.replace("_", " ")); rr.insertBefore(tag, actions);
        list.appendChild(rr);
      });
    });

    body.appendChild(el("h3", "pt-h3", "Block time (lunch, lab, PMS-side booking)"));
    var bf = el("form", "bk-form");
    var s1 = el("label", null, "Starts (local)"); var si = input("startsAt", "", "datetime-local"); si.required = true; s1.appendChild(si);
    var s2 = el("label", null, "Ends (local)"); var ei = input("endsAt", "", "datetime-local"); ei.required = true; s2.appendChild(ei);
    var s3 = el("label", "bk-wide", "Reason"); var ri = input("reason", "e.g. lab morning"); s3.appendChild(ri);
    bf.appendChild(s1); bf.appendChild(s2); bf.appendChild(s3);
    var ba = el("div", "bk-actions"); var bb = el("button", "btn btn-solid", "Block"); bb.type = "submit"; ba.appendChild(bb); bf.appendChild(ba);
    var bmsg = el("p", "bk-note"); bf.appendChild(bmsg);
    bf.addEventListener("submit", function (e) {
      e.preventDefault();
      api("/appointments/blocks", "POST", { startsAt: new Date(si.value).toISOString(), endsAt: new Date(ei.value).toISOString(), reason: ri.value })
        .then(function (r) { bmsg.textContent = r.ok ? "Blocked." : (r.body.error || "Could not block"); if (r.ok) bf.reset(); });
    });
    body.appendChild(bf);
    note(body, "Times entered here use this computer's clock; the calendar itself runs in Chicago time.");
  }

  // ---------------- inbox ----------------
  function tabInbox(body, root) {
    body.appendChild(el("h3", "pt-h3", "Texts"));
    var tl = el("div", "pt-list"); body.appendChild(tl);
    api("/comms/inbox").then(function (r) {
      if (!r.ok) return note(tl, "Could not load texts.");
      if (!r.body.inbox.length) return note(tl, "No texts yet.");
      r.body.inbox.forEach(function (m) {
        var actions = el("span", "st-actions");
        actions.appendChild(btn("Reply", "bk-navbtn", function () { replyBox(tl, m.from, m.contactId, root); }));
        if (!m.handledAt) actions.appendChild(btn("Done", "bk-navbtn", function () { api("/comms/inbox/" + m.id + "/handled", "POST", {}).then(function () { render(root); }); }));
        var rr = row((m.name || m.from) + " \u00b7 " + fmtDT(m.receivedAt) + " \u2014 " + m.body, m.action !== "none" ? m.action : (m.handledAt ? "done" : "OPEN"), actions);
        tl.appendChild(rr);
      });
    });

    body.appendChild(el("h3", "pt-h3", "Portal messages"));
    var pl = el("div", "pt-list"); body.appendChild(pl);
    api("/portal/admin/messages").then(function (r) {
      if (!r.ok) return note(pl, "Could not load portal messages.");
      if (!r.body.messages.length) return note(pl, "No portal messages yet.");
      var seen = {};
      r.body.messages.forEach(function (m) {
        var actions = el("span", "st-actions");
        if (!seen[m.accountId]) { seen[m.accountId] = true; actions.appendChild(btn("Reply", "bk-navbtn", function () { portalReplyBox(pl, m.accountId, m.from, root); })); }
        pl.appendChild(row((m.sender === "patient" ? m.from : "Staff \u2192 " + m.from) + " \u00b7 " + fmtDT(m.createdAt) + " \u2014 " + m.body,
          m.sender === "patient" && !m.readByStaffAt ? "UNREAD" : "", actions));
      });
    });
  }

  function replyBox(parent, phone, contactId, root) {
    var f = el("form", "pt-compose"); var ta = el("textarea"); ta.placeholder = "Text " + phone; ta.required = true; f.appendChild(ta);
    var s = el("button", "btn btn-solid", "Send text"); s.type = "submit"; f.appendChild(s);
    var err = el("p", "bk-error"); err.hidden = true; f.appendChild(err);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      api("/comms/sms/send", "POST", { contactId: contactId, phone: phone, body: ta.value.trim() }).then(function (r) {
        if (!r.ok) { err.textContent = r.body.error || "Could not send"; err.hidden = false; return; }
        render(root);
      });
    });
    parent.insertBefore(f, parent.firstChild);
  }

  function portalReplyBox(parent, accountId, who, root) {
    var f = el("form", "pt-compose"); var ta = el("textarea"); ta.placeholder = "Reply to " + who; ta.required = true; f.appendChild(ta);
    var s = el("button", "btn btn-solid", "Send"); s.type = "submit"; f.appendChild(s);
    var err = el("p", "bk-error"); err.hidden = true; f.appendChild(err);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      api("/portal/admin/messages", "POST", { accountId: accountId, body: ta.value.trim(), senderName: "Front Desk" }).then(function (r) {
        if (!r.ok) { err.textContent = r.body.error || "Could not send"; err.hidden = false; return; }
        render(root);
      });
    });
    parent.insertBefore(f, parent.firstChild);
  }

  // ---------------- contacts ----------------
  function tabContacts(body, root) {
    var sf = el("form", "pt-compose"); var q = input("q", "Search name, phone, or email"); sf.appendChild(q);
    var sb = el("button", "btn btn-solid", "Search"); sb.type = "submit"; sf.appendChild(sb); body.appendChild(sf);
    var list = el("div", "pt-list"); body.appendChild(list);
    function load() {
      api("/comms/contacts?q=" + encodeURIComponent(q.value.trim())).then(function (r) {
        list.innerHTML = "";
        if (!r.ok) return note(list, "Could not load contacts.");
        if (!r.body.contacts.length) return note(list, "No contacts match.");
        r.body.contacts.forEach(function (c) {
          var flags = [c.sms_transactional ? "reminders" : null, c.sms_marketing ? "text mktg" : null, c.email_marketing ? "email mktg" : null,
                       c.sms_stopped_at ? "STOPPED" : null, c.email_unsubscribed_at ? "unsubscribed" : null].filter(Boolean).join(" \u00b7 ");
          var actions = el("span", "st-actions");
          actions.appendChild(btn(c.sms_marketing ? "Revoke text mktg" : "Grant text mktg", "bk-navbtn", function () {
            api("/comms/contacts/" + c.id, "PUT", { smsMarketing: !c.sms_marketing }).then(load);
          }));
          actions.appendChild(btn(c.email_marketing ? "Revoke email mktg" : "Grant email mktg", "bk-navbtn", function () {
            api("/comms/contacts/" + c.id, "PUT", { emailMarketing: !c.email_marketing }).then(load);
          }));
          list.appendChild(row([c.first_name, c.last_name].filter(Boolean).join(" ") + " \u00b7 " + (c.phone || "") + " " + (c.email || "") + (c.last_visit_at ? " \u00b7 last visit " + fmtD(c.last_visit_at) : ""), flags || "no consent", actions));
        });
      });
    }
    sf.addEventListener("submit", function (e) { e.preventDefault(); load(); });
    load();

    body.appendChild(el("h3", "pt-h3", "Add a contact (consent as given on paper or by phone)"));
    var af = el("form", "bk-form");
    [["firstName", "First name"], ["lastName", "Last name"], ["phone", "Phone"], ["email", "Email"], ["lastVisitAt", "Last visit (YYYY-MM-DD)"]].forEach(function (d) {
      var l = el("label", null, d[1]); l.appendChild(input(d[0], "")); af.appendChild(l);
    });
    var cs = el("fieldset", "bk-radio bk-consent"); cs.appendChild(el("legend", null, "Consent recorded"));
    [["smsTransactional", "Appointment texts"], ["smsMarketing", "Marketing texts (written consent on file)"], ["emailMarketing", "Marketing email"]].forEach(function (d) {
      var l = el("label", "pt-check"); var i = el("input"); i.type = "checkbox"; i.name = d[0]; l.appendChild(i); l.appendChild(document.createTextNode(" " + d[1])); cs.appendChild(l);
    });
    af.appendChild(cs);
    var aa = el("div", "bk-actions"); var ab = el("button", "btn btn-solid", "Save contact"); ab.type = "submit"; aa.appendChild(ab); af.appendChild(aa);
    var amsg = el("p", "bk-note"); af.appendChild(amsg);
    af.addEventListener("submit", function (e) {
      e.preventDefault();
      api("/comms/contacts", "POST", { firstName: af.firstName.value, lastName: af.lastName.value, phone: af.phone.value, email: af.email.value,
        lastVisitAt: af.lastVisitAt.value || undefined, smsTransactional: af.smsTransactional.checked, smsMarketing: af.smsMarketing.checked, emailMarketing: af.emailMarketing.checked })
        .then(function (r) { amsg.textContent = r.ok ? "Saved." : (r.body.error || "Could not save"); if (r.ok) { af.reset(); load(); } });
    });
    body.appendChild(af);

    body.appendChild(el("h3", "pt-h3", "Import from a spreadsheet export"));
    note(body, "Paste CSV rows with a header line using any of: first_name, last_name, phone, email, last_visit, sms_marketing, email_marketing. Appointment-text consent is recorded for rows with a phone; marketing only where the column says yes/true/1.");
    var imf = el("form", "pt-compose"); var ta = el("textarea"); ta.placeholder = "first_name,last_name,phone,email,last_visit,sms_marketing,email_marketing"; imf.appendChild(ta);
    var ib = el("button", "btn btn-solid", "Import"); ib.type = "submit"; imf.appendChild(ib); var imsg = el("p", "bk-note"); imf.appendChild(imsg);
    imf.addEventListener("submit", function (e) {
      e.preventDefault();
      var lines = ta.value.split(/\r?\n/).filter(function (x) { return x.trim(); });
      if (lines.length < 2) { imsg.textContent = "Need a header line plus at least one row."; return; }
      var head = lines[0].split(",").map(function (h) { return h.trim().toLowerCase(); });
      var yes = function (v) { return /^(yes|true|1|y)$/i.test(String(v || "").trim()); };
      var contacts = lines.slice(1).map(function (ln) {
        var cells = ln.split(","); var o = {}; head.forEach(function (h, i) { o[h] = (cells[i] || "").trim(); });
        return { firstName: o.first_name, lastName: o.last_name, phone: o.phone, email: o.email, lastVisitAt: o.last_visit || undefined,
                 smsTransactional: Boolean(o.phone), smsMarketing: yes(o.sms_marketing), emailMarketing: yes(o.email_marketing) };
      });
      api("/comms/contacts/import", "POST", { contacts: contacts }).then(function (r) { imsg.textContent = r.ok ? "Imported " + r.body.saved + " (skipped " + r.body.skipped + ")." : (r.body.error || "Import failed"); if (r.ok) load(); });
    });
    body.appendChild(imf);
  }

  // ---------------- portal accounts ----------------
  function tabAccounts(body, root) {
    var list = el("div", "pt-list"); body.appendChild(list);
    api("/portal/admin/accounts").then(function (r) {
      if (!r.ok) return note(list, "Could not load accounts.");
      if (!r.body.accounts.length) return note(list, "No portal accounts yet.");
      r.body.accounts.forEach(function (a) {
        var actions = el("span", "st-actions");
        if (!a.email_verified) actions.appendChild(btn("Verify", "bk-navbtn", function () { api("/portal/admin/accounts/" + a.id + "/verify", "POST", {}).then(function () { render(root); }); }));
        if (!a.patient_id) actions.appendChild(btn("Link chart\u2026", "bk-navbtn", function () {
          var pid = window.prompt("Chart (patient) id to link to " + a.email + ":"); if (!pid) return;
          api("/portal/admin/accounts/" + a.id + "/link", "POST", { patientId: pid.trim() }).then(function (x) { if (!x.ok) window.alert(x.body.error || "Could not link"); render(root); });
        }));
        if (a.patient_id) actions.appendChild(btn("Post charge\u2026", "bk-navbtn", function () {
          var desc = window.prompt("Charge description (e.g. Crown #14 \u2014 patient portion):"); if (!desc) return;
          var amt = window.prompt("Amount in dollars:"); var cents = Math.round(parseFloat(amt) * 100); if (!cents) return;
          api("/portal/admin/charges", "POST", { patientId: a.patient_id, description: desc, amountCents: cents, createdBy: "console" }).then(function (x) { window.alert(x.ok ? "Posted." : (x.body.error || "Failed")); });
        }));
        list.appendChild(row(a.first_name + " " + a.last_name + " \u00b7 " + a.email + (a.phone ? " \u00b7 " + a.phone : ""),
          (a.email_verified ? "verified" : "unverified") + " \u00b7 " + (a.patient_id ? "linked to " + (a.chart_first || "") + " " + (a.chart_last || "") : "not linked"), actions));
      });
    });
  }

  // ---------------- campaigns ----------------
  function tabCampaigns(body, root) {
    var list = el("div", "pt-list"); body.appendChild(list);
    api("/comms/campaigns").then(function (r) {
      if (!r.ok) return note(list, "Could not load campaigns.");
      if (!r.body.campaigns.length) return note(list, "No campaigns yet.");
      r.body.campaigns.forEach(function (c) {
        var actions = el("span", "st-actions");
        actions.appendChild(btn("Audience", "bk-navbtn", function () { api("/comms/campaigns/" + c.id + "/audience").then(function (x) { window.alert(x.ok ? x.body.count + " consented recipient(s)" : "Could not count"); }); }));
        actions.appendChild(btn("Test\u2026", "bk-navbtn", function () {
          var to = window.prompt(c.channel === "sms" ? "Send a test to phone:" : "Send a test to email:"); if (!to) return;
          api("/comms/campaigns/" + c.id + "/test", "POST", c.channel === "sms" ? { phone: to } : { email: to }).then(function (x) { window.alert(JSON.stringify(x.body.result || x.body)); });
        }));
        if (c.status === "draft" || c.status === "cancelled") {
          actions.appendChild(btn("Send now", "bk-navbtn", function () { if (window.confirm("Schedule \"" + c.name + "\" to send now (within business hours)?")) api("/comms/campaigns/" + c.id + "/schedule", "POST", {}).then(function () { render(root); }); }));
          actions.appendChild(btn("Schedule\u2026", "bk-navbtn", function () {
            var when = window.prompt("Send at (YYYY-MM-DD HH:MM, this computer's local time):"); if (!when) return;
            api("/comms/campaigns/" + c.id + "/schedule", "POST", { scheduledAt: new Date(when.replace(" ", "T")).toISOString() }).then(function () { render(root); });
          }));
        }
        if (c.status === "scheduled" || c.status === "sending") actions.appendChild(btn("Cancel", "bk-navbtn", function () { api("/comms/campaigns/" + c.id + "/cancel", "POST", {}).then(function () { render(root); }); }));
        list.appendChild(row(c.name + " \u00b7 " + c.channel + " \u00b7 " + c.audience + (c.scheduled_at ? " \u00b7 " + fmtDT(c.scheduled_at) : ""),
          c.status + (c.recipient_count ? " \u00b7 " + c.sent_count + "/" + c.recipient_count + " sent" : ""), actions));
      });
    });

    body.appendChild(el("h3", "pt-h3", "New campaign"));
    var f = el("form", "bk-form");
    var nl = el("label", null, "Name"); var ni = input("name", "e.g. Fall whitening special"); ni.required = true; nl.appendChild(ni); f.appendChild(nl);
    var cl = el("label", null, "Channel"); var csel = el("select"); csel.name = "channel";
    [["sms", "Text (SMS) \u2014 marketing consent only"], ["email", "Email \u2014 marketing consent only"]].forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; csel.appendChild(op); });
    cl.appendChild(csel); f.appendChild(cl);
    var al = el("label", null, "Audience"); var asel = el("select"); asel.name = "audience";
    [["all", "Everyone with consent"], ["recall_due", "Recall due (6+ months)"], ["no_visit_12mo", "No visit in 12 months"], ["portal_accounts", "Portal account holders"], ["new_patients_90d", "New in the last 90 days"]].forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; asel.appendChild(op); });
    al.appendChild(asel); f.appendChild(al);
    var sl = el("label", null, "Email subject"); var sub = input("subject", ""); sl.appendChild(sub); f.appendChild(sl);
    var bl = el("label", "bk-wide", "Message \u2014 {{first_name}} merges the patient's first name; STOP / unsubscribe footers are added automatically");
    var ta = el("textarea"); ta.name = "body"; ta.required = true; ta.rows = 4; ta.className = "st-textarea"; bl.appendChild(ta); f.appendChild(bl);
    var fa = el("div", "bk-actions"); var fb = el("button", "btn btn-solid", "Save draft"); fb.type = "submit"; fa.appendChild(fb); f.appendChild(fa);
    var fmsg = el("p", "bk-note"); f.appendChild(fmsg);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      api("/comms/campaigns", "POST", { name: ni.value, channel: csel.value, audience: asel.value, subject: sub.value || undefined, body: ta.value, createdBy: "console" })
        .then(function (r) { fmsg.textContent = r.ok ? "Draft saved." : (r.body.error || "Could not save"); if (r.ok) render(root); });
    });
    body.appendChild(f);

    body.appendChild(el("h3", "pt-h3", "Automations"));
    note(body, "Reminders (48h and 24h, reply YES to confirm), recall texts after 6 months, and post-visit review requests run every minute on the server inside 8 am \u2013 9 pm Chicago time.");
    var jb = btn("Run automations now", "bk-navbtn", function () { api("/comms/jobs/run", "POST", {}).then(function (r) { jmsg.textContent = r.ok ? JSON.stringify(r.body) : (r.body.error || "Failed"); }); });
    body.appendChild(jb); var jmsg = el("p", "bk-note"); body.appendChild(jmsg);
  }

  // ---------------- log ----------------
  function tabLog(body, root) {
    var list = el("div", "pt-list"); body.appendChild(list);
    api("/comms/outbound?limit=150").then(function (r) {
      if (!r.ok) return note(list, "Could not load the log.");
      if (!r.body.outbound.length) return note(list, "Nothing sent yet.");
      r.body.outbound.forEach(function (o) {
        list.appendChild(row(fmtDT(o.created_at) + " \u00b7 " + o.channel + " \u00b7 " + o.purpose + " \u2192 " + o.to_address + " \u2014 " + (o.body || "").slice(0, 120),
          o.status + (o.block_reason ? " (" + o.block_reason + ")" : "") + (o.error ? " " + o.error.slice(0, 40) : "")));
      });
    });
  }

  // ---------------- boot ----------------
  function render(root) {
    var box = root.querySelector(".pt-box") || root.appendChild(el("div", "pt-box"));
    box.innerHTML = "";
    box.appendChild(state.token && !DEMO ? renderApp(root) : renderLogin(root));
  }
  function init() {
    var root = document.getElementById("st-root");
    if (!root) return;
    root.innerHTML = ""; root.className = "pt-root";
    state.tab = "today";
    render(root);
  }
  window.TBStaff = { init: init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
