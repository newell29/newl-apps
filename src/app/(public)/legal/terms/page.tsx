import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use | Newl Apps",
  description: "Terms of use for Newl Apps."
};

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-12">
      <div className="space-y-8">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-mutedForeground">Newl Apps</p>
          <h1 className="text-3xl font-semibold text-foreground">Terms of Use</h1>
          <p className="max-w-3xl text-sm leading-6 text-mutedForeground">
            Effective date: June 26, 2026. These terms govern access to and use of Newl Apps, an
            internal-first operations platform used to manage logistics, finance, and related business
            workflows.
          </p>
        </div>

        <section className="space-y-4 text-sm leading-6 text-foreground">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">1. Use of the service</h2>
            <p>
              Newl Apps is provided for authorized business use. You may use the service only in
              connection with legitimate operational, finance, sales, customer service, and reporting
              activities approved by your organization.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">2. Authorized access</h2>
            <p>
              Access is limited to users who have been granted credentials or approved through an
              authorized identity provider. You are responsible for maintaining the confidentiality of
              your login credentials and for activity conducted under your account.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">3. Customer and financial data</h2>
            <p>
              The service may process shipment, accounting, billing, contact, and customer data. You
              agree to use that information only for authorized business purposes and in accordance with
              applicable confidentiality, privacy, and security obligations.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">4. Third-party integrations</h2>
            <p>
              Newl Apps may connect to third-party services such as Microsoft, QuickBooks, carrier
              platforms, and other operational tools. Your use of those integrations may also be subject
              to the third party&apos;s terms and policies.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">5. Restrictions</h2>
            <p>You may not:</p>
            <ul className="list-disc space-y-1 pl-5 text-mutedForeground">
              <li>use the service for unlawful, fraudulent, or unauthorized purposes;</li>
              <li>attempt to interfere with, disrupt, or reverse engineer the service;</li>
              <li>share access credentials with unauthorized users;</li>
              <li>export or disclose confidential business data without authorization.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">6. Availability and changes</h2>
            <p>
              Features may change over time. We may update, suspend, or discontinue portions of the
              service as business needs, security requirements, or vendor dependencies evolve.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">7. Disclaimer</h2>
            <p>
              The service is provided on an as-available basis. While we aim for accurate operational and
              financial information, users remain responsible for reviewing business-critical decisions,
              reports, and postings before acting on them.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">8. Contact</h2>
            <p>
              Questions about these terms or access to Newl Apps should be directed through your Newl
              Group administrator or internal business contact.
            </p>
          </div>
        </section>

        <div className="border-t border-border pt-6 text-sm text-mutedForeground">
          <Link href="/login" className="font-medium text-primary hover:text-primaryHover">
            Return to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
