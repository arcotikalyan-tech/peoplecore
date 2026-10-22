/**
 * Starter courses for Learn's library: short, general courses HR adds to the catalog with one click. Each becomes a
 * draft course with text lessons, so HR reviews and adapts it to the company's own policies before publishing.
 */
export interface StarterCourse {
  key: string; title: string; category: string; description: string; minutes: number; validForMonths: number | null;
  lessons: Array<{ title: string; body: string; minutes: number }>;
}

const REVIEW = 'A PeopleCore starter course: review it and add your own policies, contacts and examples before publishing.';

export const STARTER_COURSES: StarterCourse[] = [
  {
    key: 'posh', title: 'Preventing sexual harassment at work (POSH)', category: 'Compliance', minutes: 40, validForMonths: 12,
    description: `What sexual harassment is, how the Internal Committee works and how to raise a concern. ${REVIEW}`,
    lessons: [
      { title: 'What the law covers', minutes: 8, body: 'The Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 protects women at work, whether they are employees, trainees, interns, contract staff or visitors. The workplace includes anywhere you go because of work, including travel and transport the company provides.\n\nMany companies, ours included if our policy says so, apply the same protection to everyone regardless of gender.' },
      { title: 'What counts as sexual harassment', minutes: 10, body: 'Any unwelcome behaviour of a sexual nature, for example: physical contact and advances, asking for sexual favours, sexually coloured remarks, showing pornography, or any other unwelcome physical, verbal or non-verbal conduct of a sexual nature.\n\nImplied promises of better treatment, threats about someone’s job, or creating an intimidating or hostile environment in connection with such behaviour are also harassment. What matters is how the behaviour is received, not what was intended.' },
      { title: 'The Internal Committee and how to complain', minutes: 12, body: 'An employer with ten or more employees must set up an Internal Committee: a senior woman employee presides, at least two employees are members, and one member comes from outside (from an NGO or someone familiar with these issues). At least half the members are women.\n\nA complaint is made in writing to the committee, normally within three months of the incident (the committee can extend this by another three months for good reason). The committee completes its inquiry within 90 days, and everything about the complaint is kept confidential.' },
      { title: 'Your part', minutes: 10, body: 'Treat colleagues with respect, think about how your words and actions land, and speak up or report when you see something wrong. Retaliating against anyone who complains or helps an inquiry is itself misconduct.\n\nYou’ll find our policy and the committee members’ names in the company policies, and HR can help you raise a concern.' },
    ],
  },
  {
    key: 'infosec', title: 'Information security basics', category: 'Security', minutes: 30, validForMonths: 12,
    description: `Passwords, two-step sign-in, phishing, devices and reporting incidents. ${REVIEW}`,
    lessons: [
      { title: 'Passwords and two-step sign-in', minutes: 8, body: 'Use a long, unique password for every work account; a password manager makes this easy. Never share passwords, even with IT or a manager.\n\nTurn on two-step sign-in wherever it is offered: a stolen password alone is then not enough to get into your account.' },
      { title: 'Spotting phishing', minutes: 8, body: 'Be wary of messages that create urgency, ask you to sign in through a link, change bank details or buy gift cards, or come from an address that is almost right. Check the sender, hover over links before clicking, and confirm unusual requests through another channel, such as a phone call to a number you already know.' },
      { title: 'Devices and data', minutes: 7, body: 'Lock your screen when you step away, keep your device updated, and use only approved apps and storage for company data. Don’t leave papers or devices unattended in public, and take care on public Wi-Fi.' },
      { title: 'Reporting an incident', minutes: 7, body: 'If you clicked a suspicious link, lost a device or think someone has your password, report it straight away: early reports limit the damage. Nobody is blamed for reporting a mistake quickly.' },
    ],
  },
  {
    key: 'privacy', title: 'Personal data and privacy at work', category: 'Compliance', minutes: 30, validForMonths: 12,
    description: `Handling personal data under India’s Digital Personal Data Protection Act, 2023. ${REVIEW}`,
    lessons: [
      { title: 'What personal data is', minutes: 7, body: 'Personal data is any data about a person who can be identified from it: names, phone numbers, addresses, ID numbers, bank details, salaries, health information and more. The Digital Personal Data Protection Act, 2023 sets the rules for handling it in digital form.' },
      { title: 'Using data properly', minutes: 8, body: 'Collect and use personal data only for a clear, lawful purpose the person was told about, or one the law allows. Take only what you need, keep it accurate, and keep it only as long as it is needed.' },
      { title: 'People’s rights', minutes: 7, body: 'People can ask what data we hold about them, ask for it to be corrected or erased, and complain if they think it was mishandled. Pass any such request to the person responsible for privacy promptly.' },
      { title: 'Keeping data safe', minutes: 8, body: 'Share personal data only with people who need it for their work, never through personal email or chat apps. If data is lost, sent to the wrong person or accessed without permission, report it at once: a breach has to be reported to the authorities and the people affected.' },
    ],
  },
  {
    key: 'conduct', title: 'Code of conduct and ethics', category: 'Compliance', minutes: 25, validForMonths: 12,
    description: `Conflicts of interest, gifts, bribery and speaking up. ${REVIEW}`,
    lessons: [
      { title: 'Acting with integrity', minutes: 6, body: 'Be honest in what you record, report and promise. Follow the law and our policies, and ask when you are unsure: a quick question early is better than a problem later.' },
      { title: 'Conflicts of interest', minutes: 6, body: 'A conflict of interest arises when a personal interest (a relative’s business, a side job, an investment) could affect a work decision. Declare it to your manager or HR so it can be handled openly.' },
      { title: 'Gifts and bribery', minutes: 7, body: 'Never offer, give, ask for or accept anything of value to win or keep business or to influence a decision. Small courtesy gifts may be allowed within our policy limits; when in doubt, decline politely and tell your manager.' },
      { title: 'Speaking up', minutes: 6, body: 'If you see something that looks wrong, raise it with your manager, HR or our whistleblowing channel. Concerns raised in good faith are protected, and retaliation is not tolerated.' },
    ],
  },
  {
    key: 'fire', title: 'Fire safety and emergency evacuation', category: 'Health and safety', minutes: 20, validForMonths: 12,
    description: `Preventing fires, using an extinguisher and leaving the building safely. ${REVIEW}`,
    lessons: [
      { title: 'Preventing fires', minutes: 5, body: 'Keep exits and corridors clear, don’t overload sockets or use damaged cables, switch off equipment you don’t need, and report faulty wiring or blocked fire doors.' },
      { title: 'Using a fire extinguisher', minutes: 7, body: 'Only tackle a small fire, and only if you have a clear way out. Remember PASS: Pull the pin, Aim at the base of the fire, Squeeze the handle and Sweep from side to side. Use the right extinguisher for the fire, for example CO₂ for electrical fires.' },
      { title: 'When the alarm sounds', minutes: 8, body: 'Stop work and leave by the nearest safe exit. Don’t use lifts or go back for belongings. Help visitors and colleagues who need assistance, go to the assembly point and stay until the fire warden says it is safe.' },
    ],
  },
  {
    key: 'first-aid', title: 'First aid basics', category: 'Health and safety', minutes: 25, validForMonths: 24,
    description: `What to do in the first minutes of a medical emergency. This is an introduction, not certified first aid training. ${REVIEW}`,
    lessons: [
      { title: 'Get help first', minutes: 5, body: 'Check that the area is safe, then call for help: 112 is India’s single emergency number. Tell the operator where you are and what happened, and send someone to fetch the first aid kit and a trained first aider.' },
      { title: 'Someone collapses', minutes: 10, body: 'If the person is unresponsive and not breathing normally, start chest compressions: push hard and fast in the centre of the chest, about 100 to 120 times a minute, and keep going until help arrives. Use an AED if one is available and follow its spoken instructions.' },
      { title: 'Bleeding and burns', minutes: 10, body: 'For bleeding, press firmly on the wound with a clean cloth and keep pressing. For burns, cool the area under cool running water for 20 minutes; don’t use ice, butter or creams, and cover it loosely with cling film or a clean, non-fluffy dressing.' },
    ],
  },
  {
    key: 'ergonomics', title: 'Healthy working: desk set-up and breaks', category: 'Health and safety', minutes: 15, validForMonths: null,
    description: `Setting up your workstation and looking after your body during the day. ${REVIEW}`,
    lessons: [
      { title: 'Setting up your desk', minutes: 6, body: 'Sit back in the chair with your feet flat, the top of the screen at about eye level and an arm’s length away, and elbows roughly at right angles when typing. When working on a laptop for long, use a separate keyboard and raise the screen.' },
      { title: 'Breaks and movement', minutes: 5, body: 'Stand up and move for a few minutes every hour. Rest your eyes with the 20-20-20 rule: every 20 minutes, look at something about 20 feet away for 20 seconds.' },
      { title: 'Speak up early', minutes: 4, body: 'Aches in the back, neck or wrists are easier to fix early. Tell your manager or HR if you need a different chair, screen or keyboard.' },
    ],
  },
  {
    key: 'orientation', title: 'Welcome: your first weeks', category: 'Onboarding', minutes: 20, validForMonths: null,
    description: `For new joiners: how things work here and where to find help. ${REVIEW}`,
    lessons: [
      { title: 'Getting set up', minutes: 6, body: 'Complete your profile in PeopleCore: personal details, bank account, emergency contacts and documents. These are needed for payroll and for keeping you safe.' },
      { title: 'Everyday tools', minutes: 7, body: 'Mark attendance, apply for leave and track approvals in PeopleCore; your payslips, tax declarations and letters are there too. Your manager approves leave and attendance corrections.' },
      { title: 'Policies and people', minutes: 7, body: 'Read the company policies in PeopleCore, especially leave, conduct and information security. Your manager and HR are your first contacts for any question.' },
    ],
  },
  {
    key: 'inclusion', title: 'Inclusion and respect at work', category: 'Culture', minutes: 20, validForMonths: null,
    description: `Unconscious bias, inclusive language and making work accessible. ${REVIEW}`,
    lessons: [
      { title: 'Unconscious bias', minutes: 7, body: 'Everyone takes mental shortcuts, and they can affect hiring, reviews and who gets heard in meetings. Slow down on important decisions, use clear criteria and ask whether you would decide the same way for someone else.' },
      { title: 'Inclusive language and behaviour', minutes: 7, body: 'Use people’s names and pronouns as they ask, avoid jokes and assumptions about gender, caste, religion, region, age or disability, and make sure everyone gets a turn to speak.' },
      { title: 'Accessibility', minutes: 6, body: 'Share documents that work with screen readers, add captions to videos and choose accessible meeting places. Ask colleagues what helps them work best, and support reasonable adjustments.' },
    ],
  },
  {
    key: 'communication', title: 'Clear communication at work', category: 'Professional skills', minutes: 25, validForMonths: null,
    description: `Writing clearly, running useful meetings and giving feedback. ${REVIEW}`,
    lessons: [
      { title: 'Writing clearly', minutes: 8, body: 'Put the request or decision first, keep sentences short and say what you need by when. Before sending, reread from the reader’s point of view.' },
      { title: 'Meetings that work', minutes: 8, body: 'Have a purpose and an agenda, invite only the people needed, and end with decisions, owners and dates written down. If a message would do, skip the meeting.' },
      { title: 'Giving and receiving feedback', minutes: 9, body: 'Describe the Situation, the Behaviour you saw and its Impact, then talk about what to do next. When receiving feedback, listen, ask questions and thank the person before deciding what to change.' },
    ],
  },
  {
    key: 'time', title: 'Managing your time and priorities', category: 'Professional skills', minutes: 20, validForMonths: null,
    description: `Prioritising, focusing and keeping commitments. ${REVIEW}`,
    lessons: [
      { title: 'Choose what matters', minutes: 7, body: 'Sort tasks by how important and how urgent they are. Do what is both, schedule what is important but not urgent, and delegate or drop the rest.' },
      { title: 'Protect focus time', minutes: 6, body: 'Block time in your calendar for deep work, silence notifications while you work, and batch email and messages into a few slots a day.' },
      { title: 'Keep commitments realistic', minutes: 7, body: 'Break big work into steps with dates, leave room for the unexpected and tell people early when something will slip. Saying no to new work is easier when your priorities are clear.' },
    ],
  },
  {
    key: 'managers', title: 'Essentials for new managers', category: 'Leadership', minutes: 35, validForMonths: null,
    description: `One-to-ones, goals, feedback and the approvals that come with managing a team. ${REVIEW}`,
    lessons: [
      { title: 'Regular one-to-ones', minutes: 8, body: 'Meet each person regularly, ideally weekly or fortnightly. Let them set most of the agenda, and cover their work, their blockers and how they are doing.' },
      { title: 'Setting goals', minutes: 9, body: 'Agree goals that are specific, measurable, achievable, relevant and time-bound, and check progress through the quarter rather than only at review time.' },
      { title: 'Feedback and recognition', minutes: 9, body: 'Give feedback soon after the event, in private when it is critical and in public when it is praise. Recognise good work specifically, saying what was done and why it mattered.' },
      { title: 'Approvals and team admin', minutes: 9, body: 'As a manager you approve leave, attendance corrections and expenses in PeopleCore. Decide promptly and fairly, check team cover before approving leave, and explain any refusal.' },
    ],
  },
];

export const STARTER_BY_KEY = new Map(STARTER_COURSES.map((c) => [c.key, c]));
