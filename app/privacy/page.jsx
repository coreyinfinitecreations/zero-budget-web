import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy · Zero Budget',
  description:
    'How Zero Budget collects, uses, stores, shares, protects, and deletes the financial data you access through Plaid.',
};

const EFFECTIVE_DATE = 'June 15, 2026';
const CONTACT_EMAIL = 'cowens7289@gmail.com';

export default function PrivacyPolicy() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">Zero Budget</span>
          <Link href="/" className="btn link">
            Home
          </Link>
        </div>
      </header>

      <main className="container legal">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Effective date: {EFFECTIVE_DATE}</p>

        <p>
          This Privacy Policy explains how Zero Budget (&ldquo;Zero
          Budget,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;),
          operated by Corey Owens, collects, uses, stores, shares, protects, and
          deletes your information when you use the Zero Budget mobile
          application, website, and related services (together, the
          &ldquo;Service&rdquo;). Zero Budget is a personal budgeting tool. We
          integrate with{' '}
          <a href="https://plaid.com" target="_blank" rel="noopener noreferrer">
            Plaid Inc.
          </a>{' '}
          (&ldquo;Plaid&rdquo;) to let you securely connect your financial
          accounts and to retrieve the account and transaction data that powers
          our budgeting features.
        </p>

        <h2>1. Information We Collect</h2>
        <p>We collect the following categories of information:</p>
        <ul>
          <li>
            <strong>Information you provide.</strong> When you create an account,
            we collect your email address. If you sign in with Apple, we receive
            the account identifier (and, if you choose to share it, your name)
            from Apple Sign in. Authentication is handled by our identity
            provider, Supabase.
          </li>
          <li>
            <strong>Financial account information (via Plaid).</strong> When you
            link a bank or other financial institution through Plaid Link, Plaid
            collects and shares with us account information such as the account
            name and official name, account type and subtype, the masked account
            number (last four digits only), the institution name, and current and
            available balances.
          </li>
          <li>
            <strong>Transaction information (via Plaid).</strong> For accounts you
            connect, we retrieve transaction data including the transaction
            amount, date, name and merchant name, category, and pending status.
          </li>
          <li>
            <strong>Budgeting information you create.</strong> Information you
            enter directly into the app, such as budget categories and
            allocations, savings goals, manually added accounts, manual
            transactions, and app preferences.
          </li>
          <li>
            <strong>Usage and technical information.</strong> Basic log and
            technical data needed to operate, troubleshoot, and secure the
            Service.
          </li>
        </ul>
        <p>
          We do not request or store full bank account or routing numbers, and we
          do not use Plaid&rsquo;s identity or credit data products. Your bank
          login credentials are entered directly into Plaid&rsquo;s secure
          interface and are never seen, collected, or stored by Zero Budget.
        </p>

        <h2>2. How We Use Plaid</h2>
        <p>
          We use Plaid to connect your financial accounts to Zero Budget. By
          linking an account, you authorize Plaid to collect financial data from
          your institution and share it with us in accordance with Plaid&rsquo;s
          own privacy policy. We exchange the temporary token returned by Plaid
          Link for a Plaid access token on our server; that access token is never
          sent to or stored on your device. We encourage you to review the{' '}
          <a
            href="https://plaid.com/legal/#end-user-privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Plaid End User Privacy Policy
          </a>{' '}
          to understand how Plaid handles your information.
        </p>

        <h2>3. How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>
            Provide and maintain the Service, including displaying your connected
            accounts and balances, syncing and categorizing transactions, and
            tracking spending against your budgets and savings goals.
          </li>
          <li>Create, secure, and authenticate your account.</li>
          <li>Respond to your requests and provide support.</li>
          <li>
            Detect, prevent, and address fraud, security issues, and technical
            problems.
          </li>
          <li>Comply with our legal obligations.</li>
        </ul>
        <p>
          We do not sell your personal information, we do not share it for
          cross-context behavioral advertising, and we do not use your financial
          data for advertising or profiling. Zero Budget contains no advertising
          networks and no third-party analytics.
        </p>

        <h2>4. How We Store and Protect Your Information</h2>
        <p>
          Your account, financial, and budgeting data is stored in our hosted
          backend, which runs on Vercel and uses a Supabase (PostgreSQL)
          database. We apply administrative, technical, and physical safeguards
          designed to protect your information, including:
        </p>
        <ul>
          <li>
            <strong>Encryption in transit:</strong> all communication between the
            app, our servers, and Plaid uses TLS 1.2 or higher (TLS 1.3
            preferred). Insecure (HTTP) connections are not permitted.
          </li>
          <li>
            <strong>Encryption at rest:</strong> data stored in our database is
            encrypted at rest using industry-standard encryption (AES-256).
          </li>
          <li>
            <strong>Access controls:</strong> every record is scoped to the user
            who owns it, and access is restricted to authorized individuals with a
            business need. Plaid access tokens are stored server-side only, are
            never returned to the client, and are never logged.
          </li>
          <li>
            <strong>Device protection:</strong> access to the app is protected by
            your account credentials and, where you enable it, your device
            passcode and biometric authentication (Face ID / Touch ID).
          </li>
        </ul>
        <p>
          No method of transmission or storage is completely secure, but we work
          to protect your information and continually improve our safeguards.
        </p>

        <h2>5. How We Share Your Information</h2>
        <p>
          We do not sell or rent your personal or financial information. We share
          information only as needed to operate the Service:
        </p>
        <ul>
          <li>
            <strong>Service providers.</strong> With vendors who help us run the
            Service under agreements that limit their use of the data &mdash;
            specifically Plaid (financial account connectivity), Supabase
            (authentication and database hosting), and Vercel (application
            hosting).
          </li>
          <li>
            <strong>Legal and safety.</strong> When required by law or to protect
            the rights, property, or safety of our users or others.
          </li>
          <li>
            <strong>Business transfers.</strong> In connection with a merger,
            acquisition, or sale of assets, subject to this policy.
          </li>
        </ul>
        <p>
          Plaid&rsquo;s handling of your data is governed by the{' '}
          <a
            href="https://plaid.com/legal/#end-user-privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Plaid End User Privacy Policy
          </a>
          .
        </p>

        <h2>6. Data Retention and Deletion</h2>
        <p>
          We keep your information only as long as needed to provide the Service
          or as required by law. You remain in control of your data at all times:
        </p>
        <ul>
          <li>
            <strong>Disconnect an account</strong> &mdash; removing a linked
            account from within the app deletes its stored account data and the
            associated Plaid access token, and stops further data retrieval from
            that institution.
          </li>
          <li>
            <strong>Delete your account or data</strong> &mdash; when you delete
            your account, we remove your associated access with Plaid and delete
            the related data from our systems within 30 days, except where
            retention is legally required.
          </li>
          <li>
            <strong>Revoke via Plaid</strong> &mdash; you may also revoke
            institution-level access at any time through the Plaid portal at{' '}
            <a
              href="https://my.plaid.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              my.plaid.com
            </a>
            .
          </li>
        </ul>

        <h2>7. Your Rights and Choices</h2>
        <ul>
          <li>
            <strong>Access and deletion.</strong> You can request a copy of your
            data or ask us to delete it by contacting us at the email below.
          </li>
          <li>
            <strong>Disconnect accounts.</strong> You can unlink a financial
            account at any time from within the app.
          </li>
          <li>
            <strong>Regional rights.</strong> Depending on where you live (for
            example, under the California Consumer Privacy Act (CCPA/CPRA) or the
            EU/UK General Data Protection Regulation (GDPR)), you may have
            additional rights regarding your personal information.
          </li>
        </ul>
        <p>To exercise any of these rights, contact us using the details below.</p>

        <h2>8. Children&rsquo;s Privacy</h2>
        <p>
          The Service is not directed to children under 18, and we do not
          knowingly collect personal information from them. If you believe a child
          has provided us information, please contact us so we can delete it.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will post the
          updated version here and revise the effective date above. Material
          changes will be communicated as appropriate.
        </p>

        <h2>10. Contact Us</h2>
        <p>
          If you have questions or requests regarding this Privacy Policy or your
          data, contact us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          <br />
          Corey Owens, 4217 Stark St, Murfreesboro, TN 37129.
        </p>
      </main>
    </>
  );
}
