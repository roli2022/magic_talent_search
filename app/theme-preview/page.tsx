import styles from './theme-preview.module.css';

const candidates = [
  {
    initial: 'A',
    name: 'Aarav Sethi',
    rank: '#1',
    headline: 'Product Lead at LedgerMint',
    meta: 'Bangalore · 8 years experience · Fintech · 0-to-1 product',
    summary:
      'Strong background in fintech product leadership with clear evidence of 0-to-1 execution, hands-on ownership, and stable recent career progression.',
    match: 'Excellent Match',
    excellent: true,
    badges: [
      ['Builder 8/10', 'orange'],
      ['Stable tenure', 'green'],
      ['Top school', 'blue'],
      ['Founder signal', 'plain'],
    ],
  },
  {
    initial: 'N',
    name: 'Neha Kulkarni',
    rank: '#2',
    headline: 'Head of Operations at Loopstack',
    meta: 'Mumbai · 11 years experience · Startup operations · Team leadership',
    summary:
      'Strong operating background across startup execution, team leadership, and high-agency cross-functional coordination in fast-moving environments.',
    match: 'Strong Match',
    excellent: false,
    badges: [
      ['Manages teams', 'green'],
      ['Ownership 9/10', 'orange'],
      ['Startup exp', 'plain'],
      ['Stable profile', 'plain'],
    ],
  },
];

export default function ThemePreviewPage() {
  return (
    <main className={styles.page}>
      <div className={styles.flowLines} aria-hidden="true">
        <div className={styles.flowTop} />
        <div className={styles.flowMid} />
        <div className={styles.flowBottom} />
      </div>

      <div className={styles.wrap}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Theme Preview</p>
            <h1 className={styles.title}>Dense candidate workspace</h1>
            <p className={styles.sub}>
              A preview-only route for the lighter, sharper, more premium design direction.
              The background flow is meant to feel like search energy narrowing into results.
            </p>
          </div>
          <div className={styles.legend}>
            <span className={styles.chip}>Sharper corners</span>
            <span className={styles.chip}>Denser cards</span>
            <span className={styles.chip}>Poppier accents</span>
            <span className={styles.chip}>Full-page flow</span>
          </div>
        </header>

        <section className={`${styles.panel} ${styles.searchPanel}`}>
          <div className={styles.searchShell}>
            <div className={styles.searchLabel}>Search Flow</div>
            <div className={styles.searchBox}>
              <div className={styles.searchIcon}>↗</div>
              <div className={styles.searchCopy}>
                <strong>Senior product builder in Bangalore with fintech and 0-to-1 experience</strong>
                <span>Strong operating instincts, founder energy, and signs of stable recent tenure.</span>
              </div>
              <button className={styles.searchCta}>Search</button>
            </div>
          </div>
        </section>

        <section className={styles.cards}>
          {candidates.map((candidate) => (
            <article
              key={candidate.name}
              className={`${styles.panel} ${styles.card} ${candidate.excellent ? styles.cardExcellent : ''}`}
            >
              <div className={styles.cardHead}>
                <div className={styles.left}>
                  <div className={styles.avatar}>{candidate.initial}</div>
                  <div className={styles.identity}>
                    <div className={styles.nameRow}>
                      <div className={styles.name}>{candidate.name}</div>
                      <div className={styles.rank}>{candidate.rank}</div>
                    </div>
                    <div className={styles.headline}>{candidate.headline}</div>
                    <div className={styles.meta}>{candidate.meta}</div>
                  </div>
                </div>
                <div className={styles.score}>{candidate.match}</div>
              </div>

              <div className={styles.summary}>{candidate.summary}</div>

              <div className={styles.row}>
                {candidate.badges.map(([label, tone]) => (
                  <span
                    key={label}
                    className={`${styles.badge} ${
                      tone === 'green'
                        ? styles.badgeGreen
                        : tone === 'orange'
                          ? styles.badgeOrange
                          : tone === 'blue'
                            ? styles.badgeBlue
                            : ''
                    }`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
