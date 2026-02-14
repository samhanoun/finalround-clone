import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: 16 }}>
      <h1>/</h1>
      <ul>
        <li>
          <Link href="/auth">/auth</Link>
        </li>
        <li>
          <Link href="/dashboard">/dashboard</Link>
        </li>
      </ul>
    </main>
  );
}
