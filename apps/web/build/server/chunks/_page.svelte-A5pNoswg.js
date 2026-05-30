import { a6 as head, Y as attr, al as ssr_context } from './renderer-BaqIXObI.js';

function onDestroy(fn) {
  /** @type {SSRContext} */
  ssr_context.r.on_destroy(fn);
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let activeCampaigns;
    let email = "admin@test.com";
    let password = "test123";
    let loading = false;
    let campaigns = [];
    let linkForm = {
      campaign_id: "",
      expires_at: daysFromNow(90)
    };
    ({ date_from: daysAgo(7), date_to: nowInput() });
    onDestroy(() => {
    });
    function daysAgo(days) {
      const date = new Date(Date.now() - days * 864e5);
      return date.toISOString().slice(0, 16);
    }
    function daysFromNow(days) {
      const date = new Date(Date.now() + days * 864e5);
      return date.toISOString().slice(0, 16);
    }
    function nowInput() {
      return (/* @__PURE__ */ new Date()).toISOString().slice(0, 16);
    }
    activeCampaigns = campaigns.filter((campaign) => campaign.status === "active");
    if (!linkForm.campaign_id && activeCampaigns[0]) linkForm.campaign_id = activeCampaigns[0].id;
    head("1uha8ag", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>TrackFlow</title>`);
      });
    });
    $$renderer2.push(`<main class="svelte-1uha8ag"><section class="hero svelte-1uha8ag"><div><p class="eyebrow svelte-1uha8ag">TrackFlow v1</p> <h1 class="svelte-1uha8ag">Fast campaign links, click analytics and PDF reports.</h1> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<form class="card login svelte-1uha8ag"><div><p class="eyebrow svelte-1uha8ag">Sign in</p> <h2 class="svelte-1uha8ag">Access your agency workspace</h2></div> <label class="svelte-1uha8ag">Email<input${attr("value", email)} autocomplete="email" class="svelte-1uha8ag"/></label> <label class="svelte-1uha8ag">Password<input${attr("value", password)} type="password" autocomplete="current-password" class="svelte-1uha8ag"/></label> <div class="actions svelte-1uha8ag"><button${attr("disabled", loading, true)} class="svelte-1uha8ag">Login</button> <button type="button" class="ghost svelte-1uha8ag">Password reset</button></div></form>`);
    }
    $$renderer2.push(`<!--]--></main>`);
  });
}

export { _page as default };
//# sourceMappingURL=_page.svelte-A5pNoswg.js.map
