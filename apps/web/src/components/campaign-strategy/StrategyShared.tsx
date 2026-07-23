import { ReactNode } from "react";
import styles from "../CampaignStrategy.module.css";

export function StrategyCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.strategyCard}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <article className={styles.detail}>
      <span>{label}</span>
      <p>{value}</p>
    </article>
  );
}

export function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
