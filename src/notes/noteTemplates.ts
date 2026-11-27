import type { NoteDocumentData, NotePageMargins, NotePageStyle } from '../types/notes';

export interface BuiltInNoteTemplate {
  id: string;
  name: string;
  badge: string;
  accentColor: string;
  defaultPageStyle: NotePageStyle;
  defaultMargins: NotePageMargins;
  previewLayout: 'meeting' | 'lecture' | 'project' | 'weekly';
  buildNoteData: (pageStyleOverride?: NotePageStyle) => NoteDocumentData;
}

function makeHeading(level: 1 | 2 | 3, text: string) {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  };
}

function makeParagraph(text: string) {
  return text
    ? { type: 'paragraph', content: [{ type: 'text', text }] }
    : { type: 'paragraph' };
}

function makeBulletList(items: string[]) {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [makeParagraph(item)],
    })),
  };
}

function makeTaskList(items: Array<{ text: string; checked?: boolean }>) {
  return {
    type: 'taskList',
    content: items.map((item) => ({
      type: 'taskItem',
      attrs: { checked: Boolean(item.checked) },
      content: [makeParagraph(item.text)],
    })),
  };
}

export const BUILT_IN_NOTE_TEMPLATES: BuiltInNoteTemplate[] = [
  {
    id: 'tpl-note-meeting',
    name: 'Meeting Notes',
    badge: 'Doc · Paginated',
    accentColor: '#FD6E88',
    defaultPageStyle: 'paginated',
    defaultMargins: 'normal',
    previewLayout: 'meeting',
    buildNoteData: (pageStyleOverride) => ({
      contentJson: {
        type: 'doc',
        content: [
          makeHeading(1, 'Meeting Notes'),
          makeParagraph('Date: Today   ·   Attendees: Team   ·   Facilitator: You'),
          makeHeading(2, 'Agenda'),
          makeBulletList([
            'Quick status check & wins since last sync',
            'Key roadmap blockers and decisions needed',
            'Upcoming milestones & deadlines',
          ]),
          makeHeading(2, 'Action Items'),
          makeTaskList([
            { text: 'Finalize design sign-off and share notes', checked: false },
            { text: 'Assign owners to top priority milestones', checked: false },
            { text: 'Schedule follow-up review session', checked: false },
          ]),
          makeHeading(2, 'Key Decisions'),
          makeParagraph('Capture agreed-upon outcomes and open questions here.'),
        ],
      },
      contentHtml:
        '<h1>Meeting Notes</h1><p>Date: Today · Attendees: Team · Facilitator: You</p><h2>Agenda</h2><ul><li>Quick status check &amp; wins since last sync</li><li>Key roadmap blockers and decisions needed</li><li>Upcoming milestones &amp; deadlines</li></ul><h2>Action Items</h2><ul data-type="taskList"><li data-checked="false">Finalize design sign-off and share notes</li><li data-checked="false">Assign owners to top priority milestones</li><li data-checked="false">Schedule follow-up review session</li></ul><h2>Key Decisions</h2><p>Capture agreed-upon outcomes and open questions here.</p>',
      plainText:
        'Meeting Notes\nDate: Today · Attendees: Team · Facilitator: You\nAgenda\nAction Items\nKey Decisions',
      pageStyle: pageStyleOverride ?? 'paginated',
      pageMargins: 'normal',
      defaultFont: 'Inter, system-ui, sans-serif',
      headerText: '',
      footerText: '',
      showPageNumbers: false,
    }),
  },
  {
    id: 'tpl-note-lecture',
    name: 'Lecture & Study Doc',
    badge: 'Doc · Study',
    accentColor: '#072D59',
    defaultPageStyle: 'paginated',
    defaultMargins: 'normal',
    previewLayout: 'lecture',
    buildNoteData: (pageStyleOverride) => ({
      contentJson: {
        type: 'doc',
        content: [
          makeHeading(1, 'Lecture Topic & Chapter'),
          makeParagraph('Course:   ·   Instructor:   ·   Readings:'),
          makeHeading(2, 'Core Concepts'),
          makeBulletList([
            'Primary definition and intuition behind the topic',
            'How this connects to previous chapters or theorems',
            'Worked example or step-by-step derivation',
          ]),
          {
            type: 'blockquote',
            content: [
              makeParagraph(
                'Key Formula / Takeaway: Write the one rule or theorem you want to remember for exams.',
              ),
            ],
          },
          makeHeading(2, 'Review Checklist'),
          makeTaskList([
            { text: 'Summarize main idea in 2 sentences without looking', checked: false },
            { text: 'Complete practice problems & verify edge cases', checked: false },
            { text: 'Flag confusing steps for office hours or AI Tutor', checked: false },
          ]),
        ],
      },
      contentHtml:
        '<h1>Lecture Topic &amp; Chapter</h1><p>Course: · Instructor: · Readings:</p><h2>Core Concepts</h2><ul><li>Primary definition and intuition behind the topic</li><li>How this connects to previous chapters or theorems</li><li>Worked example or step-by-step derivation</li></ul><blockquote><p>Key Formula / Takeaway: Write the one rule or theorem you want to remember for exams.</p></blockquote><h2>Review Checklist</h2><ul data-type="taskList"><li data-checked="false">Summarize main idea in 2 sentences without looking</li><li data-checked="false">Complete practice problems &amp; verify edge cases</li><li data-checked="false">Flag confusing steps for office hours or AI Tutor</li></ul>',
      plainText:
        'Lecture Topic & Chapter\nCore Concepts\nKey Formula / Takeaway\nReview Checklist',
      pageStyle: pageStyleOverride ?? 'paginated',
      pageMargins: 'normal',
      defaultFont: 'Inter, system-ui, sans-serif',
      headerText: '',
      footerText: '',
      showPageNumbers: false,
    }),
  },
  {
    id: 'tpl-note-project',
    name: 'Project Brief',
    badge: 'Doc · Pageless',
    accentColor: '#2563EB',
    defaultPageStyle: 'pageless',
    defaultMargins: 'normal',
    previewLayout: 'project',
    buildNoteData: (pageStyleOverride) => ({
      contentJson: {
        type: 'doc',
        content: [
          makeHeading(1, 'Project Brief'),
          makeParagraph('Owner:   ·   Target Launch:   ·   Status: Draft'),
          makeHeading(2, 'Executive Summary'),
          makeParagraph(
            'Define the problem statement, user impact, and why this project matters right now.',
          ),
          makeHeading(2, 'Goals & Scope'),
          makeBulletList([
            'Primary measurable outcome for v1 launch',
            'Key user workflows included in scope',
            'Explicit non-goals deferred to future iterations',
          ]),
          makeHeading(2, 'Milestones & Launch Checklist'),
          makeTaskList([
            { text: 'Architecture & visual design review approved', checked: true },
            { text: 'Core implementation and automated test suite green', checked: false },
            { text: 'Cross-device verification and release notes ready', checked: false },
          ]),
        ],
      },
      contentHtml:
        '<h1>Project Brief</h1><p>Owner: · Target Launch: · Status: Draft</p><h2>Executive Summary</h2><p>Define the problem statement, user impact, and why this project matters right now.</p><h2>Goals &amp; Scope</h2><ul><li>Primary measurable outcome for v1 launch</li><li>Key user workflows included in scope</li><li>Explicit non-goals deferred to future iterations</li></ul><h2>Milestones &amp; Launch Checklist</h2><ul data-type="taskList"><li data-checked="true">Architecture &amp; visual design review approved</li><li data-checked="false">Core implementation and automated test suite green</li><li data-checked="false">Cross-device verification and release notes ready</li></ul>',
      plainText:
        'Project Brief\nExecutive Summary\nGoals & Scope\nMilestones & Launch Checklist',
      pageStyle: pageStyleOverride ?? 'pageless',
      pageMargins: 'normal',
      defaultFont: 'Inter, system-ui, sans-serif',
      headerText: '',
      footerText: '',
      showPageNumbers: false,
    }),
  },
  {
    id: 'tpl-note-weekly',
    name: 'Weekly Planner',
    badge: 'Doc · Planner',
    accentColor: '#10B981',
    defaultPageStyle: 'paginated',
    defaultMargins: 'narrow',
    previewLayout: 'weekly',
    buildNoteData: (pageStyleOverride) => ({
      contentJson: {
        type: 'doc',
        content: [
          makeHeading(1, 'Weekly Focus Plan'),
          makeHeading(2, 'Top 3 Priorities'),
          makeTaskList([
            { text: 'Priority #1 — Most important deliverable', checked: false },
            { text: 'Priority #2 — Deep focus study or build session', checked: false },
            { text: 'Priority #3 — Wrap up loose ends & review', checked: false },
          ]),
          makeHeading(2, 'Daily Log'),
          makeHeading(3, 'Monday – Wednesday'),
          makeBulletList(['Key sessions, deadlines, and notes']),
          makeHeading(3, 'Thursday – Friday'),
          makeBulletList(['Wrap-ups, demos, and next-week prep']),
          makeHeading(2, 'Weekly Reflection'),
          makeParagraph('What went smoothly this week, and what should improve next week?'),
        ],
      },
      contentHtml:
        '<h1>Weekly Focus Plan</h1><h2>Top 3 Priorities</h2><ul data-type="taskList"><li data-checked="false">Priority #1 — Most important deliverable</li><li data-checked="false">Priority #2 — Deep focus study or build session</li><li data-checked="false">Priority #3 — Wrap up loose ends &amp; review</li></ul><h2>Daily Log</h2><h3>Monday – Wednesday</h3><ul><li>Key sessions, deadlines, and notes</li></ul><h3>Thursday – Friday</h3><ul><li>Wrap-ups, demos, and next-week prep</li></ul><h2>Weekly Reflection</h2><p>What went smoothly this week, and what should improve next week?</p>',
      plainText:
        'Weekly Focus Plan\nTop 3 Priorities\nDaily Log\nWeekly Reflection',
      pageStyle: pageStyleOverride ?? 'paginated',
      pageMargins: 'narrow',
      defaultFont: 'Inter, system-ui, sans-serif',
      headerText: '',
      footerText: '',
      showPageNumbers: false,
    }),
  },
];
