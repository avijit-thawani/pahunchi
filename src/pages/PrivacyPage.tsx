import { Link } from 'react-router-dom'

const CONTACT_EMAIL = 'avijit.thawani@gmail.com'

export default function PrivacyPage() {
  return (
    <main className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 space-y-4">
      <h1 className="text-3xl font-extrabold tracking-tight">Privacy</h1>
      <p className="text-sm text-base-content/60 font-semibold">Pahunchi is free. Last updated November 2026.</p>
      <Section title="Calls">
        Calls are recorded to debug and improve Pahunchi: your audio, the transcript, his replies, timings, your
        phone's IP address and browser, and any feedback you leave are stored on our servers (Supabase). Your
        speech is transcribed by Sarvam, his replies are written by Google's Gemini, and his voice comes from
        Sarvam; when one of them fails, ElevenLabs, Fish Audio, Smallest AI or Google step in. Google, ElevenLabs
        and Fish Audio are reached through OpenRouter.
      </Section>
      <Section title="Your account">
        Calls don't need an account. If you sign in with Google to use trusted contacts, we receive your name,
        email address, profile picture and Google account ID from Google, and nothing else.
      </Section>
      <Section title="Trusted contacts">
        We store the names, phone numbers and emails you enter for your trusted contacts. Someone you invite is
        linked to your account only when they accept your invite link or sign up with the email you entered. They
        see your name and email; you see whether they joined and the email of their account. While you're signed
        in, each call's start and end time, transcript and "I'm safe" time are saved to your account, and contacts
        who joined can see them in Pahunchi: right away, or only if you don't tap "I'm safe" within the time you
        chose for them. They aren't sent a message or notification.
      </Section>
      <Section title="Location">
        Off unless you turn on "Share my location during calls" in Settings. Then, during calls while you're signed
        in, your location is saved every 10 to 15 seconds, and contacts who can see the call see it on a map, on
        the same delay. In the Android app it keeps updating with the screen off; on the website only while
        Pahunchi is on screen.
      </Section>
      <Section title="Scheduled calls">
        For "Call me later" on the website, we keep the time, who calls and why, and a push address from your
        browser at our host (Netlify) until it rings. The push goes through your browser's push service (such as
        Google's or Apple's). In the Android app the phone schedules it itself.
      </Section>
      <Section title="Sharing">
        We don't sell your data or show ads. We share it only with the services that run Pahunchi (Netlify,
        Supabase, Sarvam, Smallest AI, OpenRouter and the AI providers it reaches, and your browser's push
        service) or when the law requires it.
      </Section>
      <Section title="Deleting your data">
        Remove contacts at any time in Settings. To delete everything, tap "Delete all my data" at the bottom of
        Settings. It removes, right away and for good: the recordings, transcripts, locations and feedback of
        every call made on this phone or while signed in, your scheduled calls, your account and trusted
        contacts, and everything Pahunchi saved on this phone. If someone added you as a trusted contact,
        they keep the name and email they typed, but are no longer linked to your account. Short server logs at
        our host expire on their own. What AI providers keep is up to their own policies. Questions, or calls made
        on a phone you no longer have: email{' '}
        <a className="link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </Section>
      <Link to="/" className="link link-hover text-sm font-semibold text-base-content/60 block">Back to Pahunchi</Link>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="text-lg font-extrabold">{title}</h2>
      <p className="font-semibold text-base-content/80">{children}</p>
    </section>
  )
}
