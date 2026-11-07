import { Link } from 'react-router-dom'

const CONTACT_EMAIL = 'avijit.thawani@gmail.com'

export default function PrivacyPage() {
  return (
    <main className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 space-y-4">
      <h1 className="text-3xl font-extrabold tracking-tight">Privacy</h1>
      <p className="text-sm text-base-content/60 font-semibold">Pahunchi is a free beta. Last updated November 2026.</p>
      <Section title="Calls">
        While Pahunchi is in beta, calls are recorded to improve the voice: your audio, the transcript, the
        replies and timings are stored on our servers (Supabase). They are used only to debug and improve Pahunchi.
        Speech is processed by AI providers through OpenRouter to transcribe it and generate replies.
      </Section>
      <Section title="Your account">
        Calls don't need an account. If you sign in with Google to use trusted contacts, we receive your name and
        email address from Google and nothing else.
      </Section>
      <Section title="Trusted contacts">
        We store the names, phone numbers and emails you enter for your trusted contacts. Someone you invite is
        linked to your account only when they accept your invite link or sign up with the email you entered. They
        see your name; you see whether they joined. While you're signed in, each call's start and end time,
        transcript and "I'm safe" time are saved to your account, and contacts who joined can see them: right
        away, or only if you don't tap "I'm safe" within the time you chose for them.
      </Section>
      <Section title="Sharing">
        We don't sell your data or show ads. We share it only with the services that run Pahunchi (Netlify,
        Supabase, OpenRouter and its AI providers) or when the law requires it.
      </Section>
      <Section title="Deleting your data">
        Remove contacts at any time in Settings. To delete everything, tap "Delete all my data" at the bottom of
        Settings. It removes, right away and for good: the recordings, transcripts and
        feedback of every call made on this phone or while signed in, your scheduled calls, your account and
        trusted contacts, and everything Pahunchi saved on this phone. If someone added you as a trusted contact,
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
