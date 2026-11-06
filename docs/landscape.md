<!-- Cap: 120 lines. Evidence section comes first and matters most; trim the rest before it. -->

# Why phoney: evidence and landscape (Nov 2026)

## Evidence that the behavior is real

Indian women already fake (or make) a call to a parent when a cab or walk feels off. phoney
automates a habit that exists, it does not invent one.

- **Times of India, Delhi** ([Survival instincts keep women safe](https://timesofindia.indiatimes.com/city/delhi/survival-instincts-keep-women-safe/articleshow/123881953.cms)):
  "Whenever alone in a cab or an auto and if I don't feel comfortable, I use the simple trick of
  saying something that gives the impression that I am in touch with my father throughout the
  ride." The same piece notes "a recent social media trend features audio clips that mimic
  conversations with family members, helping women pretend they are on a call", i.e. phoney's
  pre-recorded ancestor.
- **r/TeenIndia** ([safety tips thread](https://www.reddit.com/r/TeenIndia/comments/1lln4wv/all_young_women_drop_your_best_safety_tips_in/)):
  "When you get into an auto or cab... always pretend to call (or actually call) a friend or
  relative and loudly talk about WHERE you are and WHEN you will arrive. 'Haan mummy aadhe ghante
  mein pohunchungi'! Works every time." Also: "fake call to papa"; "always have one earphone on,
  so that you can pretend to talk to someone."
- **r/delhi** ([travelling alone at midnight](https://www.reddit.com/r/delhi/comments/1hvoq2j/is_delhi_really_safe_for_women_travelling_alone/)):
  "pretending like you are on a call with someone... mentioning time by time about your
  whereabouts just to alarm the driver"; "pretend a fake phone call everytime a conversation
  starts getting edgy."

Supporting numbers:

- [YouGov India](https://yougov.com/articles/32860-most-urban-indian-women-feel-unsafe-while-walking-):
  52% of urban women always/often feel unsafe walking alone at night; 48% in a taxi or ride share
  alone at night; 52% keep family informed of their whereabouts.
- [She Shakti Suraksha Survey 2025](https://www.news18.com/india/she-shakti-suraksha-survey-2025-only-36-women-feel-safe-travelling-alone-on-public-transport-at-night-9251751.html):
  36% feel safe on public transport alone at night (70% by day).
- [US rideshare survey](https://www.acaseforwomen.com/blog/the-hidden-cost-of-rideshare-trust-what-women-think-about-safety/):
  72% of women use fake calls or deceptive texting riding alone at night. No Indian equivalent found yet.

Precedents for the design:

- **Human version:** Germany's [Heimwegtelefon](https://visualjournalism.de/en/magazine/after-dark/walk-home-phone-line/),
  volunteers who stay on the line until you're home: ~4,000 callers/yr, 81% women, up to 90
  calls on a weekend night. Founded by two women who felt safer on the phone with friends who
  weren't always awake (the "don't want to disturb anyone" case).
- **Delayed alert:** China's ["Are You Dead?" / Demumu](https://www.wired.com/story/china-are-you-dead-yet-app/)
  hit #1 paid app in Jan 2026 with one button: miss check-ins for two days and a contact is emailed.

## Competitors: AI callers that talk back

None found with Indian voices, Hindi/Hinglish, or cab-aware prompts; all paid or US-centric.

- [Safella](https://safella.app/fake-call-app) (Copenhagen): Dad/Mom/Sister AI calls, scheduled
  "Date Escape", Walk With Me, server-side check-in timer, SOS. Escape calls €9.99/mo.
- [Halo](https://callinghalo.com/): no app; save a number, call it or text it to get called back.
- [Tea "Alibi"](https://support.teaforwomen.com/support/solutions/articles/158000477441-alibi-faqs):
  AI caller in Tea's paid tier.
- [SoundSafe](https://www.reddit.com/r/androidapps/comments/1dlcvn1/i_made_an_app_that_can_make_aigenerated_phone/):
  scenario calls, offers an Indian-English accent; no Hindi.
- [Call Me Maybe?](https://www.reddit.com/r/women/comments/1lw8wrd/built_something_to_help_my_girlfriend_feel_safer/):
  "boyfriend" caller, built after a bad Uber ride; subscription.

Indian safety apps (bSafe, Sekura, Saheli, RAKSHA, 112 India, Himmat Plus, Yodda TRYBE) offer SOS,
tracking and at most a silent ringing screen. Cab apps already cover part of the safety layer:
Uber India auto-records audio on night trips, Ola monitors route deviation, Rapido calls women after
10pm rides. Open-source hackathon clones (e.g. [SafeHER](https://github.com/sweetylearner-max/SafeHER))
also stop at a silent fake call; [Live Safety Monitor](https://github.com/unlatch-ai/gemini-hackathon-10-18-25)
auto-triggers a call when Gemini hears danger in ambient audio.

## What users ask for and complain about

- Asks: "a voice that says I'll stay with you till you're in" ([r/LivingAlone](https://www.reddit.com/r/LivingAlone/comments/1nnmko0/ever_wished_someone_would_just_call_and_stay_on/));
  a fake video call plausible from 5 feet away ([r/ideas](https://www.reddit.com/r/ideas/comments/1qx41un/idea_a_fake_video_call_app_for_walking_alone_at/));
  SMS instead of email alerts (Demumu users).
- Complaints about fake-call apps: robotic voices, silent calls, paywalls after ~3 calls, broken
  subscriptions, "live" calls that are canned clips.
- Pushback: being on the phone makes you less alert (top replies on r/LivingAlone), so keep the
  responder mostly quiet and support an earbud mode. The Internet Democracy Project
  ([critique](https://genderingsurveillance.internetdemocracy.in/safety-app/)) faults "guardian"
  language, constant tracking usable for family control, and weak privacy policies; under 6% of
  rapes in India are by strangers. So: say "trusted contacts", delay-by-default sharing she
  controls, a clear retention policy, no always-on tracking.
