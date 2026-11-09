/**
 * Starter policies for the Policies page: general, plain-language policies for an Indian company that HR adds as drafts
 * with one click, then adapts and publishes. Anything only the company can decide (timings, numbers of days, contacts)
 * is marked [[like this]], and a draft can't be published while any mark is left (`unfilled`). They are a starting
 * point, not legal advice: the page asks HR to check each one with their adviser.
 */
export interface StarterPolicy { key: string; title: string; body: string }

/** The parts still marked [[like this]], in order, once each. */
export function unfilled(body: string): string[] {
  return [...new Set([...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!.trim()))];
}

export const STARTER_POLICIES: StarterPolicy[] = [
  {
    key: 'conduct', title: 'Code of conduct',
    body: `This policy sets out how we expect everyone at [[company name]] to behave at work, with colleagues, clients and the public. It applies to employees, interns and contractors.

We expect you to:
- Treat everyone with respect and courtesy, whatever their role, gender, religion, caste, age, disability or background.
- Be honest in your work, your records and your claims (attendance, leave, expenses and timesheets).
- Avoid conflicts of interest. Tell your manager about outside work, investments or relationships that could affect your judgement at work.
- Not give or accept gifts, hospitality or payments meant to influence a business decision. Gifts above [[amount]] must be declared to HR.
- Protect company property, money and information, and use them only for work.
- Follow the law, and our other policies, including those on harassment, information security and data protection.
- Not come to work under the influence of alcohol or drugs.

If you see something that breaks this code, tell your manager or HR, or raise it through Grievances in PeopleCore. You will not be treated unfairly for raising a concern in good faith.

Breaking this code may lead to disciplinary action, up to and including dismissal, after a fair process in which you are heard.`,
  },
  {
    key: 'attendance', title: 'Attendance and working hours',
    body: `This policy explains our working hours and how attendance is recorded.

Working hours
- Our working days are [[working days, e.g. Monday to Friday]] and the standard shift is [[start time]] to [[end time]].
- A full day is [[hours]] hours at work, including [[break minutes]] minutes for lunch and breaks.

Recording attendance
- Check in when you start work and check out when you finish, on the PeopleCore app or website. Use Start lunch and Start break for your breaks.
- PeopleCore records the time and, where your attendance rule asks for them, your location and a photo. These are used only to record attendance.
- Arriving more than [[minutes]] minutes after the shift starts counts as late. Repeated late arrivals or early departures may be deducted as set in your attendance rule.

Missed or wrong punches
- If you forgot to check in or out, or a punch is wrong, ask for a correction in PeopleCore within [[number]] days. Your manager approves it.
- Work from home and on duty are requested in PeopleCore before the day, where possible.

Absence
- If you can't come to work, tell your manager before the shift starts and apply for leave in PeopleCore.
- Being absent without telling anyone for [[number]] working days in a row may be treated as leaving your job without notice.`,
  },
  {
    key: 'leave', title: 'Leave',
    body: `This policy explains the leave you can take and how to apply. Your current balances are always shown in PeopleCore under Leave.

Types of leave
- Casual leave: [[days]] days a year, for short personal needs.
- Sick leave: [[days]] days a year. For more than [[days]] days in a row, a medical certificate may be asked for.
- Earned leave: [[days]] days a year, credited [[monthly or yearly]]. Up to [[days]] unused days carry forward to the next year.
- Maternity leave as provided by law (currently up to 26 weeks for the first two children), and paternity leave of [[days]] days.
- Leave without pay, with your manager's approval, when your paid leave is used up.
- Public holidays follow the holiday calendar in PeopleCore.

Applying
- Apply in PeopleCore as early as you can: at least [[days]] days ahead for planned leave. Your manager approves or declines with a reason.
- For unplanned leave, tell your manager the same day and apply when you're back.
- The leave year runs from [[month]] to [[month]].

Leave taken without approval may be treated as unpaid. Unused leave is encashed at exit only where your leave rule allows it.`,
  },
  {
    key: 'wfh', title: 'Work from home and on duty',
    body: `This policy covers working away from the office: from home, or on duty at a client or another site.

Work from home
- Roles that can be done remotely may work from home up to [[number]] days a [[week or month]], agreed with your manager.
- Request it in PeopleCore before the day. Your manager approves it.
- On work-from-home days, keep your normal hours, check in and out in PeopleCore, and be reachable by phone and chat.
- Work from a quiet, private place. Keep company devices and information secure, as set out in the information security policy.

On duty
- When you work at a client site, travel for work or attend an event, request on duty in PeopleCore so the day counts as worked.

Work from home is a working arrangement, not leave. It can be paused for business needs or if this policy isn't followed.`,
  },
  {
    key: 'posh', title: 'Prevention of sexual harassment (POSH)',
    body: `[[company name]] does not tolerate sexual harassment. This policy follows the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 and applies to everyone at work, including visitors, clients and contractors, at the office, at client sites, at work events, on work travel and online.

What sexual harassment is
Any unwelcome behaviour of a sexual nature, for example physical contact and advances, a demand or request for sexual favours, sexually coloured remarks, showing pornography, or any other unwelcome physical, verbal or non-verbal conduct of a sexual nature. It also covers implied or explicit promises or threats about someone's job linked to such behaviour, and a hostile or intimidating work environment.

The Internal Committee
Our Internal Committee is presided over by a senior woman employee, has at least two employees as members and one external member, and at least half its members are women. Its current members are listed under Grievances › POSH in PeopleCore. You can also reach it at [[committee email]].

Making a complaint
- Complain in writing to the Internal Committee, or through Grievances in PeopleCore, within three months of the incident (or of the last incident in a series). The Committee can extend this by another three months if there was a good reason for the delay.
- The Committee completes its inquiry within 90 days and gives its report within 10 days of finishing. The company acts on it within 60 days.
- Complaints, the people involved and the inquiry are kept confidential.

No one will be treated unfairly for making a complaint in good faith or for helping an inquiry. A complaint found to be malicious may itself lead to action.`,
  },
  {
    key: 'equal', title: 'Equal opportunity and respect at work',
    body: `We hire, pay, train and promote people on merit. We do not discriminate on the basis of gender, gender identity, sexual orientation, religion, caste, ethnicity, disability, age, marital status, pregnancy or any other personal characteristic.

We expect everyone to:
- Treat colleagues with dignity, and not bully, insult, threaten or exclude anyone.
- Not make jokes, comments or messages that demean a person or a group.
- Make reasonable adjustments, with HR's help, so colleagues with a disability can do their work.

If you experience or see discrimination, bullying or harassment, speak to your manager or HR, or raise it through Grievances in PeopleCore. Sexual harassment is handled under the POSH policy. We will look into every concern promptly and fairly, keep it as confidential as we can, and not allow anyone to be treated unfairly for raising it.`,
  },
  {
    key: 'infosec', title: 'Information security and acceptable use',
    body: `This policy protects our systems, devices and information, and those of our clients.

Accounts and passwords
- Use a strong, unique password for every work account, and turn on two-step sign-in wherever it's offered, including PeopleCore.
- Never share your password or sign-in code, including with colleagues or anyone claiming to be from IT.

Devices
- Lock your screen when you step away. Keep your device updated and protected with a passcode.
- Install only approved software. Use only approved storage and apps for work files: [[approved tools, e.g. Google Workspace]].
- Return all company devices and data when you leave.

Email and messages
- Be careful with links and attachments. Check before acting on any request to sign in, pay, or change bank details.
- Don't forward work information to personal accounts.

Acceptable use
Company systems are for work. Limited personal use is fine if it doesn't affect your work or break the law or our policies. Don't use them for anything illegal, offensive or harmful.

Report at once to [[IT contact]] if you lose a device, click a suspicious link or think an account has been misused. Reporting early is always better.`,
  },
  {
    key: 'data', title: 'Confidentiality and data protection',
    body: `In your work you may see confidential information: about the company, our clients, and people's personal data. This policy explains how to protect it, in line with the Digital Personal Data Protection Act, 2023.

Confidential information
- Use it only for your work, share it only with people who need it, and don't discuss it in public places or on social media.
- This duty continues after you leave the company.

Personal data
- Personal data is any information about an identifiable person: names, phone numbers, addresses, ID numbers, salaries, health and attendance records.
- Collect only what is needed, use it only for the purpose it was collected for, and keep it only as long as it is needed.
- Keep it in approved systems. Don't copy it to personal devices, personal email or unapproved tools.
- Identity numbers (PAN, Aadhaar, bank details) are especially sensitive: PeopleCore masks them and records who views them.

Your own data
The company processes your personal data to employ and pay you and to meet legal duties. You can see much of it under My profile in PeopleCore and ask HR to correct it.

Report any loss or misuse of personal data at once to [[data protection contact]], so we can contain it and meet our legal duties.`,
  },
  {
    key: 'expenses', title: 'Expense and travel reimbursement',
    body: `This policy explains which work expenses we repay and how to claim them.

What we repay
- Reasonable costs of work travel: [[class of travel, e.g. economy air or 3AC rail]], local travel at [[rate]] per km by own vehicle or actual fares, and hotel stays up to [[amount]] a night.
- Meals while travelling for work, up to [[amount]] a day.
- Other work expenses approved by your manager in advance.

What we don't repay
Personal expenses, fines and penalties, alcohol, and anything not supported by a receipt.

Claiming
- Submit claims in PeopleCore within [[number]] days of the expense, with a clear receipt or invoice for each item.
- Your manager approves the claim, then finance checks it. Approved claims are paid with your salary in the next payroll.
- Advances for travel can be requested from finance and are settled against your claim.

Submitting a false or inflated claim is a serious breach of the code of conduct.`,
  },
  {
    key: 'exit', title: 'Resignation, notice period and exit',
    body: `This policy explains how to resign and what happens when someone leaves.

Resigning
- Resign in PeopleCore (or in writing to your manager and HR). Your notice period is [[notice period, e.g. 30 days]], or as stated in your appointment letter.
- During probation, the notice period is [[probation notice period]].
- The company may agree to an earlier last working day, or pay or recover salary in place of unserved notice, as your appointment letter allows. Earned leave may not be used to shorten the notice period unless your manager agrees.

Before you leave
- Hand over your work and documents to your manager.
- Return company devices, ID cards and other property. Each is cleared in PeopleCore's exit checklist.
- An exit interview helps us improve; it's confidential.

Full and final settlement
Your final salary, leave encashment where your leave rule allows it, gratuity where you are eligible, and any reimbursements, less any recoveries, are settled in your full and final settlement within the time the law requires. Your relieving and experience letters are issued once the settlement is done.

If the company ends your employment, it follows your appointment letter and the law, including any notice or pay in place of notice.`,
  },
  {
    key: 'grievance', title: 'Grievance redressal',
    body: `Everyone should be able to raise a concern about their work without fear. This policy explains how.

What you can raise
Concerns about your pay, leave or attendance, how you are treated by a colleague or manager, working conditions, or a breach of our policies or the law. Sexual harassment is handled by the Internal Committee under the POSH policy.

How to raise it
- Where you can, talk to your manager first.
- If that doesn't resolve it, or it's about your manager, raise a grievance in PeopleCore (Grievances), or write to HR at [[HR contact]].
- You can choose to raise a concern anonymously in PeopleCore; the people handling it will not see your name.

What happens next
- HR acknowledges the grievance within [[number]] working days and tells you who is looking into it.
- We aim to resolve it within [[number]] working days and tell you the outcome.
- If you're not satisfied, you can ask for a review by [[review authority, e.g. a director]].

Grievances are handled fairly and confidentially. No one will be treated unfairly for raising a concern in good faith.`,
  },
];
