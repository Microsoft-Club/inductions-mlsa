// The Fall 2026 Google Form's columns, in order (0-based, as in the CSV export and the responses
// sheet). Next year's form is a change to this file only; the CSV import and the form-sync edge
// function both read it. Headers are compared after collapsing whitespace (normalizeHeader), so the
// trailing spaces and line breaks Google leaves in header cells don't matter.
import type { AnswerSection } from './formRows.ts';

export type CandidateField =
  | 'submitted_at'
  | 'account_email'
  | 'full_name'
  | 'email'
  | 'reg_number'
  | 'phone'
  | 'department'
  | 'batch';

export type ColumnTarget =
  | { kind: 'field'; field: CandidateField }
  | { kind: 'answer'; section: AnswerSection }
  | { kind: 'preference'; rank: 1 | 2 | 3 | 4 };

export interface FormColumn {
  header: string;
  target: ColumnTarget;
}

export interface FormLayout {
  name: string;
  /** UTC offset of the form's timestamps. Asia/Karachi has no daylight saving time. */
  utcOffset: string;
  columns: FormColumn[];
}

const field = (name: CandidateField): ColumnTarget => ({ kind: 'field', field: name });
const answer = (section: AnswerSection): ColumnTarget => ({ kind: 'answer', section });
const preference = (rank: 1 | 2 | 3 | 4): ColumnTarget => ({ kind: 'preference', rank });

export const FORM_LAYOUT: FormLayout = {
  name: 'Fall 2026 induction form',
  utcOffset: '+05:00',
  columns: [
    /*  0 */ { header: 'Timestamp', target: field('submitted_at') },
    /*  1 */ { header: 'Email Address', target: field('account_email') },
    /*  2 */ { header: 'Full Name', target: field('full_name') },
    /*  3 */ { header: 'Email Address', target: field('email') },
    /*  4 */ { header: 'Registration Number', target: field('reg_number') },
    /*  5 */ { header: 'Phone Number (Whatsapp)', target: field('phone') },
    /*  6 */ { header: 'Department', target: field('department') },
    /*  7 */ { header: 'Batch', target: field('batch') },
    /*  8 */ { header: 'What motivated you to join Microsoft Club?', target: answer('general') },
    /*  9 */ { header: 'What do you hope to gain or contribute during your time with us?', target: answer('general') },
    /* 10 */ { header: "Tell us about something that you're proud of, and what your role was?", target: answer('general') },
    /* 11 */ { header: "Tell us about a time where something didn't go as planned and what you learned?", target: answer('general') },
    /* 12 */ { header: 'Describe a time you took full ownership of something. What did you do?', target: answer('general') },
    /* 13 */ { header: 'How do you see your next 3-4 years at GIKI? Any ambitions?', target: answer('general') },
    /* 14 */ { header: 'Why do you specifically want to join MLSA instead of another team or society?', target: answer('general') },
    /* 15 */ { header: 'On average, how many hours per week can you realistically commit to MLSA activities, projects, and events?', target: answer('general') },
    /* 16 */ { header: 'On a scale of 1 to 5, how would you rate your marketing skills?', target: answer('general') },
    /* 17 */ { header: 'Do you have any prior marketing experience (e.g., handling an Instagram page for a club, team, or organization)?', target: answer('general') },
    /* 18 */ { header: 'On a scale of 1 to 5, how would you rate your teamwork and collaboration skills?', target: answer('general') },
    /* 19 */ { header: 'On a scale of 1 to 5, how would you rate your logical thinking skills?', target: answer('general') },
    /* 20 */ { header: 'Tell us about a time you taught, organized, or helped others learn something — even if it was informal.', target: answer('general') },
    /* 21 */ { header: 'Have you participated in any activities involving public speaking, hosting, debates, or similar communication activity? If yes, briefly describe your experience.', target: answer('general') },
    /* 22 */ { header: 'Do you have any coding experience? If yes, please mention the languages, frameworks, or projects you have worked on.', target: answer('general') },
    /* 23 */ { header: 'Have you worked on any personal projects? (Yes/No → If yes, describe briefly)', target: answer('dev') },
    /* 24 */ { header: 'Which programming languages or frameworks do you know?', target: answer('dev') },
    /* 25 */ { header: 'Tell us something you explored recently in tech.', target: answer('dev') },
    /* 26 */ { header: 'Which technical domain are you most interested in, and what skills or technologies do you currently have experience with in that domain?', target: answer('dev') },
    /* 27 */ { header: 'Rate your familiarity with Git/GitHub (1–5)', target: answer('dev') },
    /* 28 */ { header: 'Rate your familiarity with LLMs and Coding Agents like (Claude Code, Curosr, Github-Copilot etc)', target: answer('dev') },
    /* 29 */ { header: 'Gihub link (Optional)', target: answer('dev') },
    /* 30 */ { header: 'Have you had experience with public speaking, hosting, debates, or similar activities? If yes, briefly tell us what you did.', target: answer('logikal') },
    /* 31 */ { header: 'Which parts of LogiKal interest you most? Select up to 2', target: answer('logikal') },
    /* 32 */ { header: 'Have you worked with video or audio editing before? If yes, mention the tools you use.', target: answer('logikal') },
    /* 33 */ { header: 'You may share a link to your work if you have one.', target: answer('logikal') },
    /* 34 */ { header: 'Do you have access to a good camera or mic setup? (Yes/No)', target: answer('logikal') },
    /* 35 */ { header: 'Imagine you get the chance to have a conversation with a GIKI student who has built something interesting. Beyond what they built, what would you be curious to know about their journey?', target: answer('logikal') },
    /* 36 */ { header: 'What excites you most about the Learning & Development (L&D) team?', target: answer('lnd') },
    /* 37 */ { header: 'Tell us about a time you taught, organized, or helped others learn something — even if it was informal.', target: answer('lnd') },
    /* 38 */ { header: 'Which of these areas interests you the most? (Select up to 2)', target: answer('lnd') },
    /* 39 */ { header: "What skill or topic would you most like our L&D team to cover in a workshop/bootcamp? Briefly describe what you'd like to learn, why it would be useful to you, and what you'd ideally want to be able to do by the end of the session.", target: answer('lnd') },
    /* 40 */ { header: 'Which design tools are you comfortable with?', target: answer('marketing') },
    /* 41 */ { header: 'Do you sketch/draw or engage in other art forms? (Yes/No → If yes, describe)', target: answer('marketing') },
    /* 42 */ { header: 'On a scale of 1 to 5, how would you rate your ability to create visually compelling marketing designs that balance brand consistency, effective typography and audience engagement?', target: answer('marketing') },
    /* 43 */ { header: 'On a scale of 1 to 5, how would you rate your ability to conceptualize and edit engaging reels that combine creative ideas, effective storytelling, visual appeal, and audience retention?', target: answer('marketing') },
    /* 44 */ { header: 'What excites you most about joining the Marketing Team?', target: answer('marketing') },
    /* 45 */ { header: 'Show us what you can create! Please share at least one poster, reel, video, or other creative work you’ve made. This is an important part of the selection process.', target: answer('marketing') },
    /* 46 */ { header: 'Which team is your first preference?', target: preference(1) },
    /* 47 */ { header: 'Which is your second preference?', target: preference(2) },
    /* 48 */ { header: 'Which is your third preference?', target: preference(3) },
    /* 49 */ { header: 'Which is your fourth preference?', target: preference(4) },
    /* 50 */ { header: 'What makes you different from other applicants — why should we choose you? Mention very briefly in 2-3 lines', target: answer('general') },
    // Added on 30 September for the new Brainees team; earlier responses have these blank.
    /* 51 */ { header: 'Why do you want to do research?', target: answer('brainees') },
    /* 52 */ { header: 'Why is it easier to remember a story than a list of facts?', target: answer('brainees') },
    /* 53 */ { header: 'Why can a child recognize a cat after seeing just a few cats, while a computer needs thousands of pictures? (dont use GPT, Claude for this. show your intuition here its fine to be wrong, maybe grab a tea think about it and then respond).', target: answer('brainees') },
  ],
};
