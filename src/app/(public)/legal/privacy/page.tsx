import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Newl Apps",
  description: "Privacy policy for Newl Apps."
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-12">
      <div className="space-y-8">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-mutedForeground">Newl Apps</p>
          <h1 className="text-3xl font-semibold text-foreground">Privacy Policy</h1>
          <p className="max-w-3xl text-sm leading-6 text-mutedForeground">
            Effective date: June 26, 2026. This policy explains how Newl Apps handles information in
            connection with logistics, finance, sales, customer, and operational workflows.
          </p>
        </div>

        <section className="space-y-4 text-sm leading-6 text-foreground">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">1. Information we process</h2>
            <p>Depending on the enabled modules and integrations, Newl Apps may process:</p>
            <ul className="list-disc space-y-1 pl-5 text-mutedForeground">
              <li>user account and authentication information;</li>
              <li>customer, company, and contact data;</li>
              <li>shipment, trade, operations, and logistics records;</li>
              <li>accounting, invoicing, receivables, payables, and reporting data;</li>
              <li>integration metadata from connected platforms such as Microsoft or QuickBooks.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">2. How information is used</h2>
            <p>We use information to operate and improve the service, including to:</p>
            <ul className="list-disc space-y-1 pl-5 text-mutedForeground">
              <li>authenticate users and control access;</li>
              <li>support logistics, operations, finance, and sales workflows;</li>
              <li>sync data with authorized third-party systems;</li>
              <li>generate reporting, analysis, alerts, and workflow recommendations;</li>
              <li>maintain security, auditability, and platform reliability.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">3. Sharing and disclosure</h2>
            <p>
              Information is shared only as needed to operate the service, comply with legal obligations,
              fulfill authorized business workflows, or connect to approved third-party integrations.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">4. Security</h2>
            <p>
              We use reasonable administrative, technical, and organizational safeguards to protect data
              processed by the platform. No method of storage or transmission is completely secure, so
              users should avoid placing unnecessary sensitive information into the service.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">5. Data retention</h2>
            <p>
              Data is retained according to operational, contractual, legal, and administrative needs.
              Retention periods may vary by module, tenant, record type, and connected system.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">6. Third-party services</h2>
            <p>
              Connected services may apply their own privacy terms and data handling practices. Users and
              tenant administrators should review those third-party policies separately where relevant.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">7. Policy updates</h2>
            <p>
              This policy may be updated from time to time as the platform, legal requirements, or
              integration landscape changes. Continued use of the service after updates indicates
              acceptance of the revised policy.
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">8. Contact</h2>
            <p>
              Questions about this policy or data handling practices should be directed through your Newl
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
