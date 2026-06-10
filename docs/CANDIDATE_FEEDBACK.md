# Candidate Feedback: Collin County Election Data Viewer

**Reviewer:** Maria Santos, candidate for Texas State House District 70
**Date:** February 5, 2026
**Context:** First-time candidate, former school board trustee and small business owner. My campaign manager found this tool and asked me to evaluate it for our field operation.

---

## 1. First Impressions

When I first opened the app, I saw a full-screen map of Collin County colored by party lean -- red, blue, and purple precincts. That immediately grabbed my attention. The header has clear tabs for Demographics, Elections, and Turnout, which makes sense. The design is clean and modern, almost like an Airbnb-style interface with the floating action button and slide-in panels.

My very first thought was: "OK, this is pretty. But where is MY district?" There is no way for me to filter the map to just show House District 70 precincts. I see all 330 precincts across the entire county, and I have no idea which ones are in my district just by looking at the map. That is a fundamental problem for a candidate. I had to go to the election panel, search for "District 70," load the 2022 race, and then see which precincts light up with votes vs. gray (not in race). That is several clicks to answer the most basic question I have.

The "Democrat Blue Theme" in the CSS variable comments made me smile -- but also made me wonder if Republican candidates would feel this tool has a partisan bias. The actual map coloring is fair (red for R, blue for D), but the UI chrome being blue-themed is a small thing that could matter to bipartisan adoption.

---

## 2. What I Love

**The precinct-level census profiles are gold.** When I clicked on Precinct 14 (one of my competitive precincts), a panel slid in showing me: population 3,268, median age, income brackets, education levels, top occupations, language breakdown (26% Asian languages, which matches the large Asian community I know is there), housing values, commute patterns, and veteran share. This is exactly the kind of data I need to tailor door-knocking scripts. If I know a precinct is 62% homeowners with a median home value of $426K and a lot of tech workers, I talk about property taxes and broadband infrastructure. If it is 61% renters with a median household income of $61K, I talk about cost of living and childcare.

**The language data is a campaign game-changer.** Precinct 1 shows 21.6% Spanish speakers and 12.2% Asian language speakers. Precinct 14 shows 21.6% Spanish and a huge Asian language population. I can use this to decide where to send Spanish-language mailers and where to invest in Vietnamese or Hindi outreach. No other free tool I have seen gives me this at the precinct level.

**The turnout simulator is genuinely useful for "what-if" scenarios.** I loaded the 2022 State Representative District 70 race (Plesa vs. Jolly) and used the sliders to model what happens if Democratic turnout increases by 20% or Republican turnout drops by 10%. Seeing which precincts flip and how the overall margin changes is exactly the kind of war-gaming my campaign manager wants to do. The flipped precincts getting a bold border on the map is a nice touch -- I can see geographically where the opportunity is.

**The election data itself is remarkably complete.** I found the 2022 HD-70 race and could see precinct-by-precinct results: Precinct 14 went 834 Plesa to 700 Jolly. Precinct 21 was close at 1,185 Plesa vs. 1,279 Jolly. Precinct 26 was razor-thin: 268 to 278. This is the kind of granularity I need for targeting.

**The DNC Score data adds a strategic layer.** Seeing each precinct's breakdown into Rep/Mod/Dem registration with strength scores (1 = lean, 2 = moderate, 3 = strong) tells me where the persuadable voters are. Precinct 26 showing Rep strength of only 1 (lean Republican) with the race result being 268-278 tells me that is a gettable precinct.

---

## 3. What Confuses Me

**I do not understand what "Mod" means in the party data.** The DNC Score CSV has Rep, Mod, and Dem columns. Is "Mod" moderate? Independent? Unaffiliated? Texas does not have party registration, so what is this number actually measuring? The app never explains this anywhere. For Precinct 2, there are 1,778 "Mod" voters compared to 1,271 Rep and 1,573 Dem. If I do not know what "Mod" means, I cannot make strategic decisions about those voters.

**The three view modes (Demographics, Election, Turnout) are not well explained.** Demographics shows party lean coloring but I assumed it would show racial or income demographics on the map. Elections shows results after you select a race, which makes sense. Turnout shows a green heat map, but when no election is selected, it seemed to fall back to some default data that I could not interpret. What turnout? From when?

**The forecast section only appears after you select an election.** I spent a minute looking for the "Forecast" button in the header before realizing it was hidden (`display: none`) until I picked a race. The button should always be visible, maybe grayed out with a tooltip saying "Select an election first." Hiding features entirely makes them undiscoverable.

**The command palette (Cmd+K) is a developer feature, not a campaign volunteer feature.** My 65-year-old precinct chair is not going to press Cmd+K. The button in the header just says "Cmd+K" which looks like a keyboard shortcut label, not a button. It should say "Search" or have a magnifying glass icon.

**Print view is too basic.** I tried Ctrl+P and the print stylesheet just hides the UI and shows the map. But there is no summary table, no title with the election name, and the info card placement does not render well. If I want to hand a printout to my finance committee showing "here are our target precincts," this is not usable.

---

## 4. What's Missing

**District boundary overlay.** This is the number one missing feature. I need to see the outline of House District 70 on the map, not just individual precincts. When I load the HD-70 race, the non-participating precincts go gray, which sort of shows my district shape, but it is imprecise (precincts with ballots but zero candidate votes still show gray, and there is no clear boundary line).

**A "target list" or export of competitive precincts.** I want to click a button and get a ranked list: "These are your top 15 swing precincts sorted by margin closeness, with their demographics." Right now I have to mentally piece this together by clicking individual precincts on the map. The CSV export exists but it exports raw vote data, not strategic analysis.

**Historical comparison for my specific race.** I can load 2022 HD-70, but I cannot compare it side-by-side with the 2024 presidential results in those same precincts. Did precincts that went for Plesa in 2022 also go for Harris in 2024? What was the ticket-splitting pattern? The roadmap mentions an "Election Comparison Panel" (Feature 2C) but it is not built yet.

**Voter contact data integration.** I know the security audit says the app cannot handle PII, and I respect that. But even without individual voter names, I need a way to overlay my VAN (Voter Activation Network) data -- things like doors knocked, voter contact rates, volunteer shifts by precinct. Without this, the tool is analysis-only with no connection to my actual field operation.

**Candidate vote totals in the info card.** When I click a precinct in election view, the info card shows generic stats (Rep/Mod/Dem registration). It does NOT show me the actual vote totals for that precinct in the selected election. I have to look at the CSV data or open the election panel. The info card should say "Plesa: 834, Jolly: 700, Margin: +134 D" when I click Precinct 14 with the HD-70 race loaded.

**Multi-election-year data.** I only see 2022 and 2024 election data. For campaign strategy, I need at least 3-4 cycles to identify real trends. A precinct that swung D in 2022 but has been solidly R in every other election is not a real opportunity -- it was a fluke. I need 2018 and 2020 data too.

**Population-weighted analysis.** Not all precincts matter equally. A precinct with 5,000 registered voters that is competitive is much more valuable than a precinct with 200 registered voters that is competitive. The tool does not help me prioritize by population.

---

## 5. Feature-by-Feature Review

### Map (Useful)
The Leaflet map with precinct polygons is the core of this tool and it works well. Coloring by party lean is intuitive. The precinct labels that appear when you zoom in (zoom >= 12) are helpful -- I can see "14" on the polygon instead of having to click to find out. Hover effects and click selection are smooth. My complaint: there is no way to search for a precinct by number directly on the map.

### Demographics View (Somewhat Useful)
Shows party lean coloring from the DNC Score data. The color intensity (strength 1/2/3) is a good idea but the difference between strength levels is not dramatic enough visually. I wish this view had a toggle to color precincts by demographic data instead -- e.g., "color by % Hispanic" or "color by median income." That would be much more useful for campaign targeting than party lean alone.

### Election View (Useful)
Once you select a race, each precinct colors by winning party. Non-participating precincts go gray. This is clear and works well. I just wish it showed margin-of-victory intensity (deep red = blowout R, pale red = narrow R, pale blue = narrow D, deep blue = blowout D) instead of flat colors. The roadmap lists this as Feature 2A "Margin of Victory View Mode" and it should be the top priority.

### Turnout View (Somewhat Useful)
Green heat map showing voter turnout percentage. The color scale (light green = low, dark green = high) is straightforward. But turnout data is only meaningful in the context of a specific election. Without selecting a race first, this view is confusing. And I want to see turnout by party, not just overall turnout -- if Rep turnout was 75% in a precinct but Dem turnout was only 45%, that tells me where my GOTV operation should focus.

### Forecast/Turnout Simulator (Useful)
This is the most strategically interesting feature. The sliders for Rep/Dem/Mod turnout multipliers and the voter flip rates let me model scenarios. "What if we increase Dem turnout by 15% in every precinct?" shows me the new vote totals and which precincts flip. The simulation results HTML shows original winner, simulated winner, flipped precinct count, and whether the county-level result changes. This is real campaign strategy tooling. My concern: the model seems to assume uniform turnout changes across all precincts, which is not realistic. In practice, my GOTV effort will boost turnout in specific target precincts, not everywhere evenly.

### Precinct Census Profiles (Useful)
As I said above, this is gold. Age brackets, income brackets, education levels, employment sectors, housing tenure, commute patterns, language -- it is all there, presented with clean bar charts. For Precinct 1: population 5,583, median age 32.7, median HHI $61K, 38.2% homeowners, 57.3% English-only, 21.6% Spanish. I can build a precinct-by-precinct communication strategy from this. The only issue is I do not know the data source or vintage. Is this 2020 Census? ACS 5-year estimates? 2024 updates? It matters because demographics shift fast in Collin County.

### Command Palette (Not Useful for Campaign)
A Spotlight-style search interface triggered by Cmd+K. It searches elections, views, and commands. For a developer or data analyst, this is slick. For my campaign volunteers who will be using this on a shared laptop at the field office, this is invisible. They will never discover it. Make it a visible search bar instead.

### Bookmarks/Favorites (Somewhat Useful)
You can star elections and they appear in a "Favorites" section in the panel. I bookmarked HD-70 2022 and it shows up at the top. Max 20 bookmarks, stored in localStorage. This is fine but not transformative. What I really want is to bookmark specific precincts, not elections -- I want to flag my "top 10 target precincts" and see them highlighted on the map every time I open the tool.

### Dark Mode (Not Useful for Campaign)
Toggle between light and dark themes. The dark mode uses a CartoDB dark basemap. It looks nice. But it has zero impact on campaign strategy. This is a "nice to have for late-night data sessions" feature.

### Print View (Somewhat Useful)
The `@media print` CSS hides the header, FAB, panels, and controls, then renders the map and info card. It adds a title "Collin County Election Data Viewer" via CSS `::before`. This is too generic -- it should print the currently selected election name, the date, the view mode, and ideally a summary table of results. As-is, I get a map screenshot with no context. I would not hand this to my campaign manager.

---

## 6. Campaign Use Cases I Want

### "Show me where to send Spanish-language mailers"
**Currently possible?** Partially. I can click individual precincts and check the census profile language section. Precinct 1 has 21.6% Spanish speakers. Precinct 3 has -- I would have to click it to check. There is no way to color the entire map by Spanish-speaking percentage or to get a ranked list of "top 20 precincts by Spanish-speaking population."
**What I need:** A filter/coloring mode where the map heat-maps by language, race, income, or any census variable. Plus a sortable table export.

### "Find precincts where the last Democrat won by less than 5%"
**Currently possible?** No. I can load the HD-70 2022 race and see which precincts went blue, but I cannot see the margin percentage on the map. Precinct 26 went 268 Jolly to 268 Plesa -- oops, actually 278 Jolly to 268 Plesa, a 10-vote margin. But I had to pull up the CSV data and do the math myself. The map just shows it as red (R won).
**What I need:** The Margin of Victory view (roadmap Feature 2A) is essential. Color precincts by margin, not just winner. And give me a sortable list of "closest precincts" for the selected race.

### "Which precincts flipped between 2022 and 2024?"
**Currently possible?** No. I can load one election at a time and mentally compare. Precinct 14 went D in the 2022 HD-70 race. Did it also go D for President in 2024? I have to load the presidential race, find Precinct 14, and check. There is no comparison view.
**What I need:** The Election Comparison Panel (roadmap Feature 2C). Let me pick two races and see a delta map showing which precincts shifted.

### "Where should I focus my next 500 volunteer door-knock hours?"
**Currently possible?** No. This requires combining multiple data points: (1) precincts in my district, (2) competitive margins, (3) high population, (4) low previous Dem turnout, (5) favorable demographics. I would have to manually cross-reference all of this.
**What I need:** A "target score" that combines competitiveness, population, turnout potential, and demographic favorability into a single number per precinct. Then sort by that score.

### "I need a one-page brief for each of my top 10 target precincts"
**Currently possible?** Partially. The census profile panel for each precinct is detailed, but I cannot batch-print or export them. I would have to click each precinct, screenshot the profile, and paste it into a document.
**What I need:** A "precinct brief" export that generates a PDF or printable page for a selected set of precincts, including census data, election history, and party registration.

### "Show me precincts with growing Asian populations where we should invest in community outreach"
**Currently possible?** No. The racial data exists (the `Racial Numbers by Precinct.csv` has Asian, Black, Hispanic, White columns), and it is displayed when you click a precinct, but there is no trend data (is the Asian population growing?) and no way to filter/color the map by racial demographics.
**What I need:** Demographic heat-mapping on the main map view, plus ideally Census data from multiple years to show growth trends.

---

## 7. Security Concerns

I read the Security Audit document and it is alarming. The app has 7 critical, 6 high, and 5 medium risk findings. The key issues:

**No HTTPS.** The app runs on Python's `http.server` over plain HTTP. If I am using this at a coffee shop or on the campaign office WiFi, anyone on the network can see what precincts I am looking at. This might not seem important for public election data, but if an opponent is monitoring my digital footprint, seeing that I am intensively studying Precincts 14, 26, and 64 tells them where my campaign is planning to invest. Operational security matters in campaigns.

**No authentication.** Anyone with the URL can access all the data. If I add any campaign-specific annotations, targets, or notes, they are visible to everyone.

**40+ XSS vulnerabilities via innerHTML.** The audit found that candidate names from CSV files are injected directly into HTML without sanitization. A malicious CSV could execute JavaScript. This is a theoretical risk since the data comes from Collin County's website, but if anyone modifies a CSV, it could compromise browsers.

**localStorage stores browsing history unencrypted.** My recently viewed elections and bookmarks are stored in plaintext. On a shared campaign office computer, anyone can see what I have been looking at.

**The bottom line from the audit:** "Do not store PII in this app in its current form." I agree. I will never put voter names, addresses, or phone numbers in this tool. But even for its current use case (viewing public election data), the lack of HTTPS and the XSS vulnerabilities are concerning.

For campaign use, I would need at minimum:
- HTTPS (even a self-signed cert on our local network)
- Basic password protection so only campaign staff can access it
- XSS fixes so I am not worried about someone slipping malicious data into a CSV

---

## 8. Verdict

### Would I pay for this?
In its current state, no. It is a great visualization tool for someone who loves election data, but it is not yet a campaign operations tool. If it had district boundary overlays, margin-of-victory mapping, competitive precinct ranking, demographic heat-mapping, and a target export feature, I would pay $50-100/month for it during campaign season without hesitation.

### Would I recommend it to other candidates?
I would recommend it as a research tool -- "go look at the precinct-level data to understand your district better." But I would not tell a fellow candidate to rely on it for strategic planning. It is too disconnected from the campaign workflow. You look at the data, learn interesting things, and then have to go to a spreadsheet to do the actual analysis.

### What would make it a 10/10?

1. **District filter.** Let me select "HD-70" and see only my precincts, with the district boundary drawn on the map. This is table stakes.

2. **Margin-of-victory coloring.** Not just red/blue, but a gradient showing how competitive each precinct is. This should be the default election view.

3. **Competitive precinct ranker.** An automatic list: "Here are your 20 most competitive precincts, sorted by margin, with population and demographics." Exportable to CSV.

4. **Demographic heat-mapping.** Let me color the map by any census variable: % Hispanic, median income, % renters, % college-educated. This is how I build a communication strategy.

5. **Multi-election overlay.** Show me how precincts have shifted over 3-4 election cycles, not just one snapshot.

6. **Precinct-level targeting tool.** Let me set criteria (e.g., "margin < 5%, registered voters > 2,000, % Hispanic > 15%") and get a filtered list of precincts that match. That is my canvassing universe.

7. **Exportable precinct briefs.** One-page summaries per precinct with census data, election history, party registration, and a mini-map showing where it is in the county.

8. **Basic security.** HTTPS, password protection, fixed XSS. Not enterprise-grade, just "good enough for a campaign office."

9. **Precinct bookmarking on the map.** Let me flag my target precincts and see them highlighted with a special border every time I open the tool, regardless of which election is loaded.

10. **Mobile-friendly precinct lookup.** When I am out canvassing and want to quickly check the census profile for the precinct I am in, the app should work well on my phone. The current mobile experience hides the view mode buttons and the info card disappears behind the panel.

### Final thought

This tool was clearly built by someone who understands election data deeply. The data pipeline, the precinct-level granularity, the census profiles, the turnout simulator -- these are all impressive. But it was built by a data person, not a campaign person. The gap is in the workflow: campaigns need to go from data to decisions to action. Right now, this tool is strong on data and weak on decisions and action. Close that gap and you have something candidates would fight over.

-- Maria Santos
Candidate, Texas House District 70
