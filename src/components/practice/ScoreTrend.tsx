import styles from './PracticeList.module.css';

export type TrendPoint = { score: number; date: string };

const GRID = [100, 50, 0];
/** Scores 0–100 drawn between these heights (in % of the plot), so the line never touches the edges. */
const TOP = 8;
const BOTTOM = 92;

const yFor = (score: number) => BOTTOM - (Math.max(0, Math.min(100, score)) / 100) * (BOTTOM - TOP);

/**
 * Overall scores of completed practice interviews, oldest first: a neutral
 * line with the latest point in the accent. Drawn without a chart library so
 * it renders on the server.
 */
export function ScoreTrend(props: {
  points: TrendPoint[];
  title: string;
  outOf: string;
  change: string | null;
  direction: 'up' | 'down' | 'same' | null;
  chartLabel: string;
}) {
  const { points } = props;
  const latest = points[points.length - 1];
  const xFor = (index: number) => (points.length === 1 ? 100 : (index / (points.length - 1)) * 100);
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xFor(index).toFixed(2)} ${yFor(point.score).toFixed(2)}`).join(' ');

  return (
    <section className={styles.trend} aria-label={props.title}>
      <div className={styles.trendFigure}>
        <p className={styles.trendTitle}>{props.title}</p>
        <p className={styles.trendValue}>
          <span className={styles.trendNumber}>{latest.score}</span>
          <span className={styles.trendOf}>{props.outOf}</span>
        </p>
        {props.change ? (
          <p className={styles.trendChange} data-direction={props.direction ?? undefined}>
            {props.change}
          </p>
        ) : null}
      </div>

      {points.length > 1 ? (
        <div className={styles.chart} role="img" aria-label={props.chartLabel}>
          <div className={styles.axis} aria-hidden="true">
            {GRID.map((value) => (
              <span key={value} style={{ top: `${yFor(value)}%` }}>
                {value}
              </span>
            ))}
          </div>
          <div className={styles.plot} aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={styles.plotSvg}>
              {GRID.map((value) => (
                <line key={value} x1="0" x2="100" y1={yFor(value)} y2={yFor(value)} className={styles.gridLine} vectorEffect="non-scaling-stroke" />
              ))}
              <path d={path} className={styles.line} vectorEffect="non-scaling-stroke" />
            </svg>
            {points.map((point, index) => (
              <span
                key={`${point.date}-${index}`}
                className={index === points.length - 1 ? styles.latestPoint : styles.point}
                style={{ left: `${xFor(index)}%`, top: `${yFor(point.score)}%` }}
              />
            ))}
          </div>
          <div className={styles.dates} aria-hidden="true">
            <span>{points[0].date}</span>
            <span>{latest.date}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
