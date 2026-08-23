// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 議論のモード(2 つの AI にどう話させるか)と、モードごとの既定プロンプトテンプレート。
// モードは「テンプレート一式」に過ぎず、Runner の進行(先攻→後攻→先攻…)は変わらない。
// テンプレートは 5 本: 開始(先攻の 1 ターン目)/ 反論(後攻の 2 ターン目)/ 先攻の中継(3 ターン目以降の先攻)/
// 後攻の中継(4 ターン目以降の後攻)/ まとめ(最後の 2 ターン。両者が 1 回ずつ。4 ターン未満なら無し)。
// 対称なモードは 2 本の中継が同じ文になる。展開できる変数: {topic} {opponent} {message}(開始だけ {message} なし)。
// 進行役(タイムキーパー)の一文は毎ターン先頭に付く(TIMEKEEPER、{turn} {max} {remaining})。2026-08-23 利用者の案。
// 2026-08-23 利用者の決定: 候補に挙げたモードを全部入れる(ロールプレイだけは「テーマ欄に役割を書く」のが特殊なので見送り)。

import type { Lang } from './types';

export const MODES = [
  'debate',
  'collab',
  'brainstorm',
  'dialectic',
  'relay',
  'review',
  'interview',
  'socratic',
  'devil',
  'quiz',
] as const;
export type Mode = (typeof MODES)[number];

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

export interface DebateTemplates {
  /** 先攻への最初の指示。{topic} {opponent} を展開 */
  openingTemplate: string;
  /** 後攻への最初の指示。{topic} {opponent} {message} を展開 */
  counterTemplate: string;
  /** 3 ターン目以降の先攻への指示。{topic} {opponent} {message} を展開 */
  relayFirstTemplate: string;
  /** 4 ターン目以降の後攻への指示。{topic} {opponent} {message} を展開 */
  relaySecondTemplate: string;
  /** 最後の 2 ターン(まとめ)。{topic} {opponent} {message} を展開。{message} は相手の最後の通常発言 */
  closingTemplate: string;
}

/**
 * 進行役(タイムキーパー)。毎ターンの先頭に template を付け、{phase} には進み具合に応じた段階の指示が入る。
 * 序盤(〜1/3): 論点を出し切る / 中盤(〜2/3): 絞って深める / 終盤(まとめの前まで): 新しい論点を出さず収束させる。
 * ぎりぎりまでまとまりのない議論をして最後に急にまとめる、を防ぐため(2026-08-23 利用者の意図)。
 * template には {turn} {max} {remaining} {phase} を展開できる
 */
export interface Timekeeper {
  template: string;
  early: string;
  middle: string;
  late: string;
}

export const TIMEKEEPER: Record<Lang, Timekeeper> = {
  ja: {
    template: '【進行役】{turn}/{max} ターン目(残り {remaining} ターン)。{phase}',
    early: 'いまは序盤です。論点を出し切り、立場を明確にしてください。',
    middle: 'いまは中盤です。論点を絞り、重要なものを深めてください。',
    late: 'いまは終盤です。新しい論点は出さず、結論に向けて収束させてください。',
  },
  en: {
    template: '[Timekeeper] Turn {turn} of {max} ({remaining} remaining). {phase}',
    early: 'This is the early phase: lay out all the points and make your position clear.',
    middle: 'This is the middle phase: narrow down the points and go deeper on the important ones.',
    late: 'This is the late phase: raise no new points and converge toward a conclusion.',
  },
};

/** 先攻・後攻の役割が違うモード(操作バーの表示と、後攻の中継文が別になる) */
export const ASYMMETRIC_MODES: ReadonlySet<Mode> = new Set<Mode>([
  'review',
  'interview',
  'socratic',
  'devil',
  'quiz',
]);

const JA_INTRO = 'あなたはこれから別のAI({opponent})と';
const JA_LIMIT = '400字以内';
const EN_INTRO = 'You are about to work with another AI ({opponent})';
const EN_LIMIT = 'no more than 250 words';

/** 対称なモード用: 中継を 1 本書けば先攻・後攻の両方に使う */
function symmetric(opening: string, counter: string, relay: string, closing: string): DebateTemplates {
  return {
    openingTemplate: opening,
    counterTemplate: counter,
    relayFirstTemplate: relay,
    relaySecondTemplate: relay,
    closingTemplate: closing,
  };
}

const JA: Record<Mode, DebateTemplates> = {
  debate: symmetric(
    `${JA_INTRO}議論します。テーマ: 「{topic}」。まず、このテーマについてあなたの立場と根拠を${JA_LIMIT}で述べてください。`,
    `${JA_INTRO}議論します。テーマ: 「{topic}」。相手の最初の主張は以下のとおりです。${JA_LIMIT}で反論または深掘りしてください。\n\n{message}`,
    `相手({opponent})の発言:\n\n{message}\n\nこれに対して${JA_LIMIT}で応答し、議論を続けてください。`,
    `相手({opponent})の最後の発言:\n\n{message}\n\n議論はここまでです。双方の主張を公平に整理し、合意できた点・意見が分かれたままの点・あなたの最終的な結論を${JA_LIMIT}で述べてください。`,
  ),
  collab: symmetric(
    `${JA_INTRO}協力して、ひとつの答えを作り上げます。テーマ: 「{topic}」。まず、たたき台となる案を${JA_LIMIT}で示してください。`,
    `${JA_INTRO}協力して、ひとつの答えを作り上げます。テーマ: 「{topic}」。相手のたたき台は以下のとおりです。良い点は活かし、足りない点を補って、${JA_LIMIT}で案を改善してください。\n\n{message}`,
    `相手({opponent})の案:\n\n{message}\n\n合意できる点を確認し、残る課題を埋める形で、${JA_LIMIT}で案を更新してください。`,
    `相手({opponent})の最後の案:\n\n{message}\n\n作業はここまでです。ここまでで到達した答えを完成形として${JA_LIMIT}でまとめ、残っている課題があれば添えてください。`,
  ),
  brainstorm: symmetric(
    `${JA_INTRO}ブレインストーミングをします。テーマ: 「{topic}」。評価や批判はせず、できるだけ多様なアイデアを${JA_LIMIT}で挙げてください。`,
    `${JA_INTRO}ブレインストーミングをします。テーマ: 「{topic}」。相手のアイデアは以下のとおりです。否定せず、それに乗っかるか別の角度から、新しいアイデアを${JA_LIMIT}で足してください。\n\n{message}`,
    `相手({opponent})のアイデア:\n\n{message}\n\n否定せず、まだ出ていない方向のアイデアを${JA_LIMIT}で足してください。`,
    `相手({opponent})の最後のアイデア:\n\n{message}\n\nブレインストーミングはここまでです。出たアイデアを整理し、特に有望なものを数個選んで理由とともに${JA_LIMIT}でまとめてください。`,
  ),
  dialectic: symmetric(
    `${JA_INTRO}弁証法的に議論します。テーマ: 「{topic}」。まず「正」として、あなたの主張と根拠を${JA_LIMIT}で述べてください。`,
    `${JA_INTRO}弁証法的に議論します。テーマ: 「{topic}」。相手の「正」は以下のとおりです。「反」として、その弱点や見落としを${JA_LIMIT}で示してください。\n\n{message}`,
    `相手({opponent})の発言:\n\n{message}\n\n相手の主張の正しい部分を取り込み、両者を止揚した一段上の結論を${JA_LIMIT}で示してください。`,
    `相手({opponent})の最後の発言:\n\n{message}\n\n議論はここまでです。正・反の要点と、両者を止揚した最終的な「合」を${JA_LIMIT}で述べてください。`,
  ),
  relay: symmetric(
    `${JA_INTRO}リレー形式で物語を書きます。お題: 「{topic}」。物語の冒頭を${JA_LIMIT}で書いてください。`,
    `${JA_INTRO}リレー形式で物語を書きます。お題: 「{topic}」。ここまでの物語は以下のとおりです。続きを${JA_LIMIT}で書いてください。\n\n{message}`,
    `相手({opponent})が書いた続き:\n\n{message}\n\nこの続きを${JA_LIMIT}で書いてください。`,
    `相手({opponent})が書いた続き:\n\n{message}\n\n物語はここで終わります。結末を${JA_LIMIT}で書いてください。`,
  ),
  review: {
    openingTemplate: `${JA_INTRO}作業します。あなたは作者、相手はレビュアーです。お題: 「{topic}」。お題に対する案を${JA_LIMIT}で示してください。`,
    counterTemplate: `${JA_INTRO}作業します。あなたはレビュアー、相手は作者です。お題: 「{topic}」。作者の案は以下のとおりです。良い点と問題点を挙げ、具体的な改善点を${JA_LIMIT}で指摘してください。\n\n{message}`,
    relayFirstTemplate: `レビュアー({opponent})の指摘:\n\n{message}\n\n指摘を踏まえて案を修正し、修正版を${JA_LIMIT}で示してください。`,
    relaySecondTemplate: `作者({opponent})の修正版:\n\n{message}\n\n修正で解決した点と残る問題点を挙げ、次の改善点を${JA_LIMIT}で指摘してください。`,
    closingTemplate: `相手({opponent})の最後の発言:\n\n{message}\n\n作業はここまでです。最終版の案と、レビューを通じて改善された点・なお残る懸念を${JA_LIMIT}でまとめてください。`,
  },
  interview: {
    openingTemplate: `${JA_INTRO}対談します。あなたは聞き手、相手は語り手です。テーマ: 「{topic}」。最初の質問を${JA_LIMIT}で投げかけてください。`,
    counterTemplate: `${JA_INTRO}対談します。あなたは語り手、相手は聞き手です。テーマ: 「{topic}」。聞き手の質問は以下のとおりです。${JA_LIMIT}で答えてください。\n\n{message}`,
    relayFirstTemplate: `語り手({opponent})の答え:\n\n{message}\n\n答えを受けて、さらに掘り下げる質問を${JA_LIMIT}で投げかけてください。`,
    relaySecondTemplate: `聞き手({opponent})の質問:\n\n{message}\n\n${JA_LIMIT}で答えてください。`,
    closingTemplate: `相手({opponent})の最後の発言:\n\n{message}\n\n対談はここまでです。対談で明らかになった要点を${JA_LIMIT}でまとめてください。`,
  },
  socratic: {
    openingTemplate: `${JA_INTRO}ソクラテス式の問答をします。あなたは先生、相手は生徒です。テーマ: 「{topic}」。答えを教えるのではなく、生徒が自分で考えるための最初の問いを${JA_LIMIT}で投げかけてください。`,
    counterTemplate: `${JA_INTRO}ソクラテス式の問答をします。あなたは生徒、相手は先生です。テーマ: 「{topic}」。先生の問いは以下のとおりです。自分の考えを${JA_LIMIT}で答えてください。\n\n{message}`,
    relayFirstTemplate: `生徒({opponent})の答え:\n\n{message}\n\n答えの中の前提や矛盾を突く、次の問いを${JA_LIMIT}で投げかけてください。`,
    relaySecondTemplate: `先生({opponent})の問い:\n\n{message}\n\n自分の考えを見直しながら${JA_LIMIT}で答えてください。`,
    closingTemplate: `相手({opponent})の最後の発言:\n\n{message}\n\n問答はここまでです。問答を通じて明らかになったこと・考えが変わった点を${JA_LIMIT}でまとめてください。`,
  },
  devil: {
    openingTemplate: `${JA_INTRO}議論します。テーマ: 「{topic}」。まず、このテーマについてあなたの立場と根拠を${JA_LIMIT}で述べてください。`,
    counterTemplate: `${JA_INTRO}議論します。あなたは「悪魔の代弁者」で、相手の主張に何があっても反対します。テーマ: 「{topic}」。相手の主張は以下のとおりです。最も手強い反論を${JA_LIMIT}で述べてください。\n\n{message}`,
    relayFirstTemplate: `相手({opponent})の反論:\n\n{message}\n\n反論に答え、あなたの立場を${JA_LIMIT}で立て直してください。`,
    relaySecondTemplate: `相手({opponent})の発言:\n\n{message}\n\nあなたは悪魔の代弁者です。同意せず、別の角度からの反論を${JA_LIMIT}で述べてください。`,
    closingTemplate: `相手({opponent})の最後の発言:\n\n{message}\n\n議論はここまでです。反論に耐えた主張と崩れた主張を整理し、最終的な結論を${JA_LIMIT}で述べてください。`,
  },
  quiz: {
    openingTemplate: `${JA_INTRO}クイズをします。あなたは解答者、相手は出題者です。ジャンル: 「{topic}」。まず出題者に「問題をください」と伝え、意気込みを${JA_LIMIT}で述べてください。`,
    counterTemplate: `${JA_INTRO}クイズをします。あなたは出題者、相手は解答者です。ジャンル: 「{topic}」。相手の発言は以下のとおりです。ジャンルに合った問題を 1 問、${JA_LIMIT}で出してください(答えはまだ書かない)。\n\n{message}`,
    relayFirstTemplate: `出題者({opponent})の発言:\n\n{message}\n\n問題に答え、根拠を${JA_LIMIT}で述べてください。`,
    relaySecondTemplate: `解答者({opponent})の答え:\n\n{message}\n\n正解かどうかを判定して解説し、次の問題を 1 問出してください(${JA_LIMIT})。`,
    closingTemplate: `相手({opponent})の最後の発言:\n\n{message}\n\nクイズはここまでです。出題と解答の結果を振り返り、成績と総評を${JA_LIMIT}で述べてください。`,
  },
};

const EN: Record<Mode, DebateTemplates> = {
  debate: symmetric(
    `You are about to debate another AI ({opponent}). Topic: "{topic}". First, state your position on this topic and your reasons in ${EN_LIMIT}.`,
    `You are about to debate another AI ({opponent}). Topic: "{topic}". Your opponent's opening statement is below. Rebut it or dig deeper in ${EN_LIMIT}.\n\n{message}`,
    `Your opponent ({opponent}) said:\n\n{message}\n\nRespond in ${EN_LIMIT} and keep the debate going.`,
    `Your opponent ({opponent}) last said:\n\n{message}\n\nThe debate ends here. Summarize both sides fairly: the points of agreement, the points still disputed, and your final conclusion, in ${EN_LIMIT}.`,
  ),
  collab: symmetric(
    `${EN_INTRO} to build one answer together. Topic: "{topic}". Start with a first draft in ${EN_LIMIT}.`,
    `${EN_INTRO} to build one answer together. Topic: "{topic}". Your partner's first draft is below. Keep what works, fill in what is missing, and improve the draft in ${EN_LIMIT}.\n\n{message}`,
    `Your partner ({opponent}) proposed:\n\n{message}\n\nConfirm what you agree on, close the remaining gaps, and update the draft in ${EN_LIMIT}.`,
    `Your partner ({opponent}) last proposed:\n\n{message}\n\nThe work ends here. Present the answer you reached as a finished version in ${EN_LIMIT}, noting any open issues.`,
  ),
  brainstorm: symmetric(
    `${EN_INTRO} for a brainstorming session. Topic: "{topic}". Without judging or criticizing, list as many diverse ideas as you can in ${EN_LIMIT}.`,
    `${EN_INTRO} for a brainstorming session. Topic: "{topic}". Your partner's ideas are below. Do not reject them; build on them or add ideas from a different angle in ${EN_LIMIT}.\n\n{message}`,
    `Your partner ({opponent}) suggested:\n\n{message}\n\nWithout rejecting anything, add ideas in directions not yet covered, in ${EN_LIMIT}.`,
    `Your partner ({opponent}) last suggested:\n\n{message}\n\nThe brainstorming ends here. Organize the ideas and pick the most promising few with reasons, in ${EN_LIMIT}.`,
  ),
  dialectic: symmetric(
    `${EN_INTRO} in a dialectical discussion. Topic: "{topic}". As the thesis, state your claim and reasons in ${EN_LIMIT}.`,
    `${EN_INTRO} in a dialectical discussion. Topic: "{topic}". The thesis is below. As the antithesis, show its weaknesses and blind spots in ${EN_LIMIT}.\n\n{message}`,
    `Your partner ({opponent}) said:\n\n{message}\n\nTake in what is right in their claim and present a synthesis that rises above both positions, in ${EN_LIMIT}.`,
    `Your partner ({opponent}) last said:\n\n{message}\n\nThe discussion ends here. State the key points of thesis and antithesis and your final synthesis in ${EN_LIMIT}.`,
  ),
  relay: symmetric(
    `${EN_INTRO} to write a story in relay. Prompt: "{topic}". Write the opening of the story in ${EN_LIMIT}.`,
    `${EN_INTRO} to write a story in relay. Prompt: "{topic}". The story so far is below. Continue it in ${EN_LIMIT}.\n\n{message}`,
    `Your partner ({opponent}) continued:\n\n{message}\n\nWrite what happens next in ${EN_LIMIT}.`,
    `Your partner ({opponent}) continued:\n\n{message}\n\nThe story ends here. Write the ending in ${EN_LIMIT}.`,
  ),
  review: {
    openingTemplate: `${EN_INTRO}. You are the author and your partner is the reviewer. Task: "{topic}". Present your proposal in ${EN_LIMIT}.`,
    counterTemplate: `${EN_INTRO}. You are the reviewer and your partner is the author. Task: "{topic}". The author's proposal is below. Name its strengths and problems and give concrete improvements in ${EN_LIMIT}.\n\n{message}`,
    relayFirstTemplate: `The reviewer ({opponent}) said:\n\n{message}\n\nRevise your proposal accordingly and present the revised version in ${EN_LIMIT}.`,
    relaySecondTemplate: `The author ({opponent}) revised:\n\n{message}\n\nSay what the revision fixed and what problems remain, then give the next improvements in ${EN_LIMIT}.`,
    closingTemplate: `Your partner ({opponent}) last said:\n\n{message}\n\nThe work ends here. Summarize the final proposal, what the review improved, and any remaining concerns, in ${EN_LIMIT}.`,
  },
  interview: {
    openingTemplate: `${EN_INTRO} in an interview. You are the interviewer and your partner is the guest. Topic: "{topic}". Ask your first question in ${EN_LIMIT}.`,
    counterTemplate: `${EN_INTRO} in an interview. You are the guest and your partner is the interviewer. Topic: "{topic}". The interviewer's question is below. Answer in ${EN_LIMIT}.\n\n{message}`,
    relayFirstTemplate: `The guest ({opponent}) answered:\n\n{message}\n\nFollow up with a question that digs deeper, in ${EN_LIMIT}.`,
    relaySecondTemplate: `The interviewer ({opponent}) asked:\n\n{message}\n\nAnswer in ${EN_LIMIT}.`,
    closingTemplate: `Your partner ({opponent}) last said:\n\n{message}\n\nThe interview ends here. Summarize the key points that came out of it in ${EN_LIMIT}.`,
  },
  socratic: {
    openingTemplate: `${EN_INTRO} in a Socratic dialogue. You are the teacher and your partner is the student. Topic: "{topic}". Do not give answers; ask a first question that makes the student think for themselves, in ${EN_LIMIT}.`,
    counterTemplate: `${EN_INTRO} in a Socratic dialogue. You are the student and your partner is the teacher. Topic: "{topic}". The teacher's question is below. Answer with your own thinking in ${EN_LIMIT}.\n\n{message}`,
    relayFirstTemplate: `The student ({opponent}) answered:\n\n{message}\n\nAsk the next question that probes the assumptions or contradictions in that answer, in ${EN_LIMIT}.`,
    relaySecondTemplate: `The teacher ({opponent}) asked:\n\n{message}\n\nReconsider your view and answer in ${EN_LIMIT}.`,
    closingTemplate: `Your partner ({opponent}) last said:\n\n{message}\n\nThe dialogue ends here. Summarize what became clear and where your thinking changed, in ${EN_LIMIT}.`,
  },
  devil: {
    openingTemplate: `You are about to debate another AI ({opponent}). Topic: "{topic}". First, state your position on this topic and your reasons in ${EN_LIMIT}.`,
    counterTemplate: `You are about to debate another AI ({opponent}) as the devil's advocate: you oppose their claim no matter what. Topic: "{topic}". Their claim is below. Give the strongest possible rebuttal in ${EN_LIMIT}.\n\n{message}`,
    relayFirstTemplate: `Your opponent ({opponent}) objected:\n\n{message}\n\nAnswer the objection and rebuild your position in ${EN_LIMIT}.`,
    relaySecondTemplate: `Your opponent ({opponent}) said:\n\n{message}\n\nYou are the devil's advocate. Do not agree; object from another angle in ${EN_LIMIT}.`,
    closingTemplate: `Your opponent ({opponent}) last said:\n\n{message}\n\nThe debate ends here. Sort out which claims survived the objections and which did not, and give your final conclusion in ${EN_LIMIT}.`,
  },
  quiz: {
    openingTemplate: `${EN_INTRO} for a quiz. You are the contestant and your partner is the quizmaster. Category: "{topic}". Ask the quizmaster for a question and say how you feel about it in ${EN_LIMIT}.`,
    counterTemplate: `${EN_INTRO} for a quiz. You are the quizmaster and your partner is the contestant. Category: "{topic}". The contestant said the following. Ask one question in the category in ${EN_LIMIT} (do not reveal the answer yet).\n\n{message}`,
    relayFirstTemplate: `The quizmaster ({opponent}) said:\n\n{message}\n\nAnswer the question and explain your reasoning in ${EN_LIMIT}.`,
    relaySecondTemplate: `The contestant ({opponent}) answered:\n\n{message}\n\nJudge whether it is correct, explain, and ask the next question (${EN_LIMIT}).`,
    closingTemplate: `Your partner ({opponent}) last said:\n\n{message}\n\nThe quiz ends here. Review the questions and answers and give the score and overall comments in ${EN_LIMIT}.`,
  },
};

export const DEFAULT_TEMPLATES: Record<Lang, Record<Mode, DebateTemplates>> = { ja: JA, en: EN };
