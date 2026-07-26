"use client";

import { useMemo, useState } from "react";
import styles from "./PromptInspector.module.css";

type PromptSource = {
  key: string;
  label: string;
  loaded: boolean;
  summary: string;
};

type KnowledgeItem = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  summary: string;
  similarity: number;
  similarityPercent: number;
  hybridScore: number;
  scoreBreakdown: {
    semantic: number;
    keyword: number;
    usage: number;
    freshness: number;
    quality: number;
  };
  matchedTerms: string[];
  matchedQueries: string[];
  reasons: string[];
  embeddingModel: string;
  embeddingDimensions: number;
  embeddedAt: string;
};

type PromptChain = {
  loadedSourceCount: number;
  totalSourceCount: number;
  sources: PromptSource[];
  queryUnderstanding?: {
    intent: string;
    contentType: string;
    audience: string;
    tone: string;
    industry: string;
    platform: string;
    language: string;
    concepts: string[];
    retrievalQueries: string[];
    expandedQuery: string;
    source: "AI" | "FALLBACK";
  };
  knowledgeUsed?: KnowledgeItem[];
  mergedPrompt?: string;
};

export function PromptInspector({
  promptChain,
  onMessage,
}: {
  promptChain?: PromptChain;
  onMessage: (message: string) => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);

  const readiness = useMemo(() => {
    if (!promptChain?.totalSourceCount) return 0;

    return Math.round(
      (promptChain.loadedSourceCount /
        promptChain.totalSourceCount) *
        100,
    );
  }, [promptChain]);

  const promptLength = promptChain?.mergedPrompt?.length ?? 0;

  async function copyPrompt() {
    if (!promptChain?.mergedPrompt) {
      onMessage("No merged prompt is available.");
      return;
    }

    await navigator.clipboard.writeText(
      promptChain.mergedPrompt,
    );

    onMessage("Merged prompt copied.");
  }

  if (!promptChain) {
    return (
      <section className={styles.emptyState}>
        <strong>No prompt inspection available</strong>
        <p>
          Generate a new workspace to inspect the prompt sources.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.inspector}>
      <header className={styles.hero}>
        <div>
          <p>Prompt Inspector</p>
          <h3>See exactly what Atlas used.</h3>
          <span>
            Review loaded sources, selected knowledge and the
            merged prompt used for generation.
          </span>
        </div>

        <div className={styles.summaryGrid}>
          <Summary
            label="Sources"
            value={`${promptChain.loadedSourceCount}/${promptChain.totalSourceCount}`}
          />
          <Summary
            label="Readiness"
            value={`${readiness}%`}
          />
          <Summary
            label="Prompt length"
            value={`${promptLength.toLocaleString()} chars`}
          />
        </div>
      </header>

      {promptChain.queryUnderstanding ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span>Query understanding</span>
              <strong>
                {promptChain.queryUnderstanding.source}
              </strong>
            </div>
          </div>

          <div className={styles.intentGrid}>
            <QueryField
              label="Intent"
              value={promptChain.queryUnderstanding.intent}
            />
            <QueryField
              label="Content type"
              value={
                promptChain.queryUnderstanding.contentType
              }
            />
            <QueryField
              label="Audience"
              value={
                promptChain.queryUnderstanding.audience
              }
            />
            <QueryField
              label="Tone"
              value={promptChain.queryUnderstanding.tone}
            />
            <QueryField
              label="Industry"
              value={
                promptChain.queryUnderstanding.industry
              }
            />
            <QueryField
              label="Platform"
              value={
                promptChain.queryUnderstanding.platform
              }
            />
          </div>

          <div className={styles.conceptList}>
            <span>Search concepts</span>

            <div>
              {promptChain.queryUnderstanding.concepts.map(
                (concept) => (
                  <small key={concept}>{concept}</small>
                ),
              )}
            </div>
          </div>

          <div className={styles.queryList}>
            <span>Retrieval queries</span>

            <ol>
              {promptChain.queryUnderstanding.retrievalQueries.map(
                (query) => (
                  <li key={query}>{query}</li>
                ),
              )}
            </ol>
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span>Prompt sources</span>
            <strong>
              {promptChain.loadedSourceCount} loaded
            </strong>
          </div>
        </div>

        <div className={styles.sourceGrid}>
          {promptChain.sources.map((source) => (
            <article
              key={source.key}
              className={
                source.loaded
                  ? styles.loadedSource
                  : styles.missingSource
              }
            >
              <div>
                <strong>
                  {source.loaded ? "✓" : "○"} {source.label}
                </strong>
                <span>
                  {source.loaded ? "Loaded" : "Missing"}
                </span>
              </div>

              <p>{source.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span>Knowledge used</span>
            <strong>
              {promptChain.knowledgeUsed?.length ?? 0} documents
            </strong>
          </div>

          <a href="/knowledge">Open Knowledge Library</a>
        </div>

        {promptChain.knowledgeUsed?.length ? (
          <div className={styles.knowledgeGrid}>
            {promptChain.knowledgeUsed.map((document) => (
              <article key={document.id}>
                <div className={styles.knowledgeHeading}>
                  <span>{document.category}</span>
                  <strong>
                    {Math.round(document.hybridScore)}% hybrid match
                  </strong>
                </div>

                <h4>{document.title}</h4>
                <p>{document.summary}</p>

                <div className={styles.scoreBreakdown}>
                  <ScoreMetric
                    label="Semantic"
                    value={document.scoreBreakdown.semantic}
                  />
                  <ScoreMetric
                    label="Keyword"
                    value={document.scoreBreakdown.keyword}
                  />
                  <ScoreMetric
                    label="Usage"
                    value={document.scoreBreakdown.usage}
                  />
                  <ScoreMetric
                    label="Freshness"
                    value={document.scoreBreakdown.freshness}
                  />
                  <ScoreMetric
                    label="Quality"
                    value={document.scoreBreakdown.quality}
                  />
                </div>

                {document.matchedTerms.length ? (
                  <div className={styles.matchTerms}>
                    <span>Matched terms</span>
                    <strong>
                      {document.matchedTerms.join(", ")}
                    </strong>
                  </div>
                ) : null}

                {document.matchedQueries.length ? (
                  <div className={styles.matchedQueries}>
                    <span>Matched queries</span>

                    <ul>
                      {document.matchedQueries.map((query) => (
                        <li key={query}>{query}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {document.reasons.length ? (
                  <ul className={styles.reasons}>
                    {document.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}

                <div className={styles.semanticMeta}>
                  <div>
                    <span>Model</span>
                    <strong>{document.embeddingModel}</strong>
                  </div>

                  <div>
                    <span>Dimensions</span>
                    <strong>
                      {document.embeddingDimensions}
                    </strong>
                  </div>

                  <div>
                    <span>Embedded</span>
                    <strong>
                      {new Intl.DateTimeFormat("en-MY", {
                        dateStyle: "medium",
                      }).format(new Date(document.embeddedAt))}
                    </strong>
                  </div>
                </div>

                <div>
                  {document.tags.slice(0, 6).map((tag) => (
                    <small key={tag}>{tag}</small>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyKnowledge}>
            No Knowledge Library documents were loaded.
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span>Merged prompt</span>
            <strong>
              {promptLength.toLocaleString()} characters
            </strong>
          </div>

          <div className={styles.promptActions}>
            <button
              type="button"
              disabled={!promptChain.mergedPrompt}
              onClick={() =>
                setShowPrompt((current) => !current)
              }
            >
              {showPrompt ? "Hide prompt" : "View prompt"}
            </button>

            <button
              type="button"
              disabled={!promptChain.mergedPrompt}
              onClick={() => void copyPrompt()}
            >
              Copy prompt
            </button>
          </div>
        </div>

        {showPrompt ? (
          <pre className={styles.prompt}>
            {promptChain.mergedPrompt ||
              "No merged prompt is available."}
          </pre>
        ) : (
          <div className={styles.promptPreview}>
            {promptChain.mergedPrompt
              ? promptChain.mergedPrompt.slice(0, 420)
              : "Generate a new workspace to inspect the prompt."}
            {promptLength > 420 ? "…" : ""}
          </div>
        )}
      </section>
    </section>
  );
}

function QueryField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScoreMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value.toFixed(1)}</strong>
    </div>
  );
}

function Summary({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className={styles.summaryCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
