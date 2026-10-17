Hey ChatGPT. So, I wanted to build something for our club's induction. So I am in Microsoft Club GIK, and we have club inductions, also known as recruitment, coming in the next two months, and I wanted to make a system for our induction for our team, which can streamline the things, which can smooth out the things for our team. So, the typical way of how it works is that there is one person outside the room. We have a total of three rooms. One room is used for waiting, and the other two are used for interviews. Each room has one panel, and there is one person outside the room, which, for example, let's call him the queue manager. So he assigns which person should go to which panel, and then when the person comes in, we know the form number, the Google form number of that person. So we take out that person's form and start evaluating. And after the evaluation is done, he leaves the room, and we input our evaluation, or whatever the feedback is, in a separate spreadsheet. So, during the interview, we talk to each other through WhatsApp, which is quite inefficient. Like, for example, you have to keep track of a lot of things. You have to keep chatting on WhatsApp. You have to look at the form, Google form, and then you will have to write your evaluation or review somewhere else on Google Sheet or whatever that is. So I wanted to make a website which can do all this in one place. So let's, for example, say that the queue manager can assign each person to the panel. He has a list of all the people that have registered for interviews or recruitment, and whenever that person arrives, he or she can assign that person to a panel. And based on the panel availability, for example, if the panel is free, he will be directly allocated. But if the panel is not free, so he will have to wait. And also, the queue manager can move the position of each person in the queue. So, for example, if there are already two persons waiting in the queue, but a third person comes along and he says, No, I have an emergency. I want my interview to be held right now. So he can be moved ahead of the other two people. But this is one of the features that we need to implement. It's not necessary to implement it from the very beginning. So right now, I want you to develop just an MVP that has most of the important, richest features in it, and then we will move on to making it more good. So in the panel, we have people. We have the people from junior year and senior year. So there are approximately, I think, 20 people. So they will need to log in. They will have some fixed credentials that only admin can change or admin can know, and he can distribute those credentials among those people. And they can log in, and they can choose the panel they are currently in right now. For example, if the person, if the panelist or the interviewer comes in, he sits in panel one. So when he signs up, he should be able to register himself in panel one, and then he will be able to insert the feedback or evaluation of the person being interviewed. Also, I want you to make... So also, we have a projector in the room, and the projector should display the next person that is going to come inside and his Google form number. Okay? So we will export the CSV Google form. The queue manager will do that export, and he will get the list of all the people that registered. And based on that, he can insert and delete people from the queue. Okay? So when he inserts the person in a queue who is going to be interviewed, so that person should display on the projector, and when the interview starts, there should be a timer that should spin off. So a timer and the person being interviewed and his Google form number. So for that, what we can do is we can make two pages, and there we can present that on the projector, and those will be like separate pages or a part of a website where it can easily be done. Not... Yeah, it shouldn't be that much complex. And yeah, so when the person arrives, the panelist can search a Google form and can look into Google form and ask questions. And also the panel should be able to chat with each other in that panel. For example, the panel has five people in it, so they should be able to chat in that panel. And each discussion, the discussion for each candidate should be isolated in somehow, or it should be flagged with something, so that we know that for this person we had this discussion during the interviews. So we need to have all these things implemented. And yeah, I guess that's all. So let's make a plan, or let's first... I want to ask you what you understand from what I said, and let's make it more concrete or solid. If you have any questions, ask me.

Yes. I understand the system you have in mind. The core idea is to replace the current combination of **Google Forms + Google Sheets + WhatsApp + verbal queue management** with one induction dashboard.

I would structure it around **four roles/screens**:

1. **Queue Manager**
2. **Panelist**
3. **Projector / Display**
4. **Admin**

And the important thing is that all four are looking at the same live state.

## 1. How I understand the current process

You have:

* Around **20 interviewers/panelists**
* **2 interview rooms**
* **1 waiting room**
* **1 queue manager** outside
* Each interview panel has multiple panelists, potentially around 5
* Candidates have a **Google Form number** that identifies their application
* Candidates arrive physically
* Queue manager decides which panel gets the candidate
* Panelists open the candidate's Google Form response
* Panel conducts the interview
* Panel discusses the candidate, currently through WhatsApp
* Panel submits evaluation somewhere else
* Meanwhile, the next candidate needs to know when to enter

The system should make this flow something like:

```text
                 ┌──────────────────────┐
                 │    Queue Manager     │
                 │                      │
                 │ Candidate arrives    │
                 │ Assign to Panel 1/2  │
                 └──────────┬───────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │    Waiting    │
                    │     Queue     │
                    └───────┬───────┘
                            │
                  ┌─────────┴─────────┐
                  ▼                   ▼
           ┌─────────────┐     ┌─────────────┐
           │   Panel 1   │     │   Panel 2   │
           │             │     │             │
           │ Candidate   │     │ Candidate   │
           │ Form        │     │ Form        │
           │ Timer       │     │ Timer       │
           │ Discussion  │     │ Discussion  │
           │ Evaluation  │     │ Evaluation  │
           └──────┬──────┘     └──────┬──────┘
                  │                   │
                  └─────────┬─────────┘
                            ▼
                    ┌───────────────┐
                    │   Completed   │
                    │   Candidate   │
                    └───────────────┘
```

And simultaneously:

```text
              PROJECTOR
        ┌─────────────────────┐
        │                     │
        │   NOW INTERVIEWING  │
        │                     │
        │   Form #184         │
        │                     │
        │      17:32          │
        │                     │
        └─────────────────────┘
```

## 2. The most important concept: candidate state

I think we should make the candidate have a clear **state** throughout the induction.

Something like:

```text
REGISTERED
    ↓
WAITING
    ↓
ASSIGNED TO PANEL
    ↓
CALLED / NEXT
    ↓
INTERVIEWING
    ↓
COMPLETED
```

Potentially later:

```text
WAITING
  ↓
SKIPPED
  ↓
RETURNED TO QUEUE
```

This is important because it makes the whole system predictable.

For example, the queue manager shouldn't manually have to communicate:

> "Candidate 184 is going to Panel 1."

Instead, they click:

**Assign → Panel 1**

and everyone immediately sees:

```text
Panel 1
Candidate #184
Status: Ready
```

The projector also updates.

---

# 3. Queue Manager dashboard

This is probably the most important MVP interface.

Something roughly like:

```text
┌───────────────────────────────────────────────────────────────┐
│ Microsoft Club GIKI Inductions                    Queue: 12  │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│ WAITING QUEUE                                                 │
│                                                               │
│  #184  Ali Khan        B33     [Panel 1] [Panel 2] [Remove]  │
│  #192  Ahmed           B34     [Panel 1] [Panel 2] [Remove]  │
│  #201  Hamza           B33     [Panel 1] [Panel 2] [Remove]  │
│                                                               │
├──────────────────────────────┬────────────────────────────────┤
│ PANEL 1                      │ PANEL 2                        │
│                              │                                │
│ #176                         │ #181                           │
│ Interviewing                 │ Interviewing                   │
│ 12:43                        │ 08:21                          │
│                              │                                │
│ Next: #184                    │ Next: #192                    │
│                              │                                │
│ [Complete]                   │ [Complete]                    │
└──────────────────────────────┴────────────────────────────────┘
```

The queue manager can:

* Import the Google Forms CSV
* See all candidates
* Search by form number/name
* Add candidate to queue
* Remove candidate from queue
* Assign candidate to Panel 1/2
* See which panels are occupied
* See who is currently interviewing
* See who is next
* Move candidates up/down in queue
* Eventually drag-and-drop candidates
* Mark candidates as absent/skipped
* Reassign candidates

### One thing I'd change

I wouldn't make the queue manager manually select a panel every time if we can avoid it.

We can have:

**Assign automatically**

which chooses an available panel.

And:

**Assign manually**

for exceptional cases.

That gives you speed during an actual induction.

---

# 4. Panel dashboard

Each panelist logs in.

They select:

```text
Panel 1
```

Once inside, they see the panel's current candidate.

Something like:

```text
┌──────────────────────────────────────────────────────────┐
│ Panel 1                               Candidates Today: 18│
├──────────────────────────────────────────────────────────┤
│                                                          │
│ CURRENT CANDIDATE                                        │
│                                                          │
│ Form #184                                                │
│ Name: Ali Khan                                           │
│ Batch: B33                                               │
│                                                          │
│ [Open Application]    [Start Interview]                 │
│                                                          │
│              ⏱ 17:32                                    │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ PANEL DISCUSSION                                         │
│                                                          │
│ Yawar: I think his backend experience is strong          │
│ Hamza: Agreed, but system design was weak                │
│ Ali: We should ask about Docker                         │
│                                                          │
│ [ Write message...                         ] [Send]       │
├──────────────────────────────────────────────────────────┤
│ EVALUATION                                               │
│                                                          │
│ Technical:       [ 1 2 3 4 5 ]                           │
│ Communication:   [ 1 2 3 4 5 ]                           │
│ Problem Solving: [ 1 2 3 4 5 ]                           │
│                                                          │
│ Overall Feedback                                         │
│ ┌──────────────────────────────────────────────────────┐ │
│ │                                                      │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│                 [Submit Evaluation]                      │
└──────────────────────────────────────────────────────────┘
```

The important thing here is that **the discussion belongs to the candidate**.

So instead of a generic WhatsApp-style chat:

```text
Panel 1 Chat
```

we have:

```text
Panel 1
Candidate #184
Discussion
```

When candidate #184 is completed, the discussion is archived with #184.

Then candidate #192 gets a completely new discussion.

That gives you an interview history.

---

# 5. Candidate/application information

You mentioned that the panel should be able to search the Google Form number and look at the Google Form.

There are two ways we can approach this.

### MVP approach

Import the Google Forms CSV.

Store the candidate's responses in our database.

Then panelists can search:

```text
184
```

and see:

```text
Form #184

Name
Email
Batch
Department
Why do you want to join?
Previous experience
Technical experience
...
```

This is actually better than opening Google Forms repeatedly.

### Later

We can potentially connect directly to Google Sheets/Forms APIs.

But I wouldn't make that part of the MVP.

For an induction event, **CSV import is simpler and much less likely to break**.

---

# 6. Projector display

I think we should actually have **two projector modes**, as you suggested.

### Display A: Queue

```text
        MICROSOFT CLUB GIKI

             UP NEXT

              #184

           Ali Khan

          PANEL 1
```

### Display B: Interview

Once the interview starts:

```text
        MICROSOFT CLUB GIKI

          CURRENTLY
         INTERVIEWING

             #184

          Ali Khan

          17:32
```

Potentially even:

```text
PANEL 1

CURRENTLY INTERVIEWING

#184
Ali Khan

17:32

Please wait until your
number is called.
```

This page should require **no login**.

You could literally open:

```text
/ display / room
```

on the projector computer.

The display updates automatically through WebSockets or realtime subscriptions.

---

# 7. Timer

The timer should **not live only in the browser**.

This is an important implementation detail.

Suppose Panel 1 clicks:

**Start Interview**

at:

```text
12:31:20
```

The backend stores:

```text
startedAt = 12:31:20
```

Then every client calculates:

```text
current time - startedAt
```

That means if:

* panelist refreshes
* projector refreshes
* another panelist joins
* laptop sleeps briefly

the timer doesn't reset.

This becomes a shared interview timer.

---

# 8. Panel chat

I think this is one of the more valuable features.

Instead of:

```text
WhatsApp
↓
"what do you guys think?"
↓
"probably good"
↓
"ask him about..."
↓
"wait which candidate?"
```

you get:

```text
Candidate #184
────────────────────────

Yawar
Backend experience seems strong.

Hamza
Agreed. Ask about distributed systems.

Maimoona
Communication is good so far.

Ali
Can someone ask about Docker?

[ Send message... ]
```

And when the interview is finished:

```text
Candidate #184
Interview
Discussion
Evaluation
```

becomes a historical record.

This could be very useful later when the team reviews candidates.

---

# 9. Authentication

For the ~20 panelists, I agree that you don't need a complicated signup system.

I'd actually avoid "signup" altogether.

Instead:

```text
Admin creates account

username: panelist_07
password: ********

Panelist logs in
       ↓
Chooses Panel 1 / Panel 2
```

But there's an important question here:

### Should panelists be able to change panels?

For example:

```text
Yawar

Currently assigned:
Panel 1

[ Switch to Panel 2 ]
```

I'd probably make panel selection a **session-level choice**, rather than permanently assigning a person to a panel.

That handles situations where people move between rooms.

---

# 10. Admin

For the MVP, Admin doesn't need to be a huge dashboard.

Admin should primarily manage:

### Panelists

```text
Yawar       panelist_01    Active
Hamza       panelist_02    Active
Maimoona    panelist_03    Active
...
```

Actions:

* Create account
* Change password
* Disable account
* Reset password

### Induction

Admin can also:

* Create an induction session
* Upload candidate CSV
* Clear/reset data
* Configure panels
* Configure evaluation criteria

---

# 11. One thing I'd strongly recommend: an "Induction Session"

Don't make the database assume there's only ever going to be one induction.

Create something like:

```text
Induction
──────────────
ID: 2026-IND-01
Name: Inductions 2026
Date: ...
Status: Active
```

Then candidates, interviews, discussions and evaluations belong to that induction.

That means next year you don't have to rebuild everything.

You simply create:

```text
Inductions 2027
```

and start fresh.

---

# 12. MVP scope

I would keep **MVP 1** relatively tight.

### Must have

**Authentication**

* Admin login
* Panelist login
* Fixed credentials
* Password management

**Candidate management**

* CSV import
* Search candidates
* Candidate details
* Add/remove from queue

**Queue**

* Waiting queue
* Position
* Assign Panel 1/2
* Panel availability
* Current candidate
* Next candidate

**Panel**

* Current candidate
* Candidate information
* Start interview
* Shared timer
* Candidate-specific discussion
* Evaluation form
* Complete interview

**Projector**

* Next candidate
* Candidate number
* Panel
* Current interview
* Timer

**Realtime**

* Queue updates
* Panel updates
* Timer synchronization
* Chat synchronization
* Projector updates

---

# 13. Features I'd deliberately leave for MVP 2

Things like:

* Drag-and-drop queue
* Emergency priority
* Automatic panel balancing
* Candidate notifications
* SMS
* WhatsApp integration
* Google Forms API
* Advanced analytics
* Interview statistics
* Average interview time
* Panel performance statistics
* Candidate scoring analytics
* Multiple induction rounds
* Candidate self-check-in
* QR codes
* Audit logs
* Automatic recommendations

The important thing is to get the **actual induction-day workflow** working first.

---

# 14. The biggest question I have

Before we start designing the database and architecture, there are a few things I need to clarify because they will affect the design.

### A. What exactly is the Google Forms CSV like?

For example, does it contain:

```text
Timestamp
Email
Name
Batch
Form Number
Phone
Questions...
```

And is the **Google Form number** something already present in the CSV, or is it simply the spreadsheet row number?

This is important.

### B. What does "panel" mean?

You said there are two interview rooms and each has a panel.

Can one panelist only belong to one panel for the entire induction, or can people move between Panel 1 and Panel 2?

### C. Who decides when an interview starts?

Is it:

```text
Queue Manager assigns candidate
        ↓
Candidate enters room
        ↓
Panelist clicks "Start Interview"
```

or should the queue manager click something like **"Candidate Entered"**, which starts the interview?

I'd recommend the former, because the panel actually knows when the interview begins.

### D. Evaluation structure

What does your current evaluation look like?

For example, is it:

```text
Technical: /10
Communication: /10
Problem Solving: /10
Culture Fit: /10
Comments
```

or is the evaluation more qualitative?

If you already have an existing Google Sheet/form for this, we should mirror that structure.

### E. Candidate identity

Do you need to show the candidate's **name** on the projector, or only:

```text
Form #184
```

I'd lean toward only the form number on the projector for privacy, unless your current induction process publicly calls candidates by name.

### F. Does the queue manager sit at a laptop?

I'm assuming yes.

And I'm assuming the projector has its own computer/browser that can open the display page.

### G. Most importantly: internet

Will the induction venue have reliable internet/Wi-Fi?

Because this determines whether we should design this as a normal cloud-hosted realtime application or consider some degree of local/offline resilience.

---

Once these are answered, I think we can move to the **actual system design**: database schema, user roles, page structure, realtime architecture, API/WebSocket events, and then a concrete MVP tech stack.


So there needs to be some changes in this when the queue manager exports the Google form so each candidate has a Google form number in the excel sheet and based on that one the queue manager export imports the see a CSV file one time for for for the first time sorry So it should assign each candidate with that Google form number and for example two or three people register after that so it should be able to recognize the duplicates and based on that it should only insert the new ones because the Google form numbers do not change for the candidates so keep that in mind By default they are all registered because we are collecting the information from Google form so they have all registered for the inductions but if someone arrives at someday he should be marked arrived and then assign to a panel and then called interviewing and completed Everything else looks good Yeah so the skip option is also very valid for example if someone is waiting and he'cause he went off to some somewhere place someplace else so he should be kept Or that person should move down the queue Yeah so the The Open application feature is good it should automatically open the Google form And the start interview should be in the hand of the queue manager when the queue manager gives a green signal for someone to go into the room At that moment the queue manager should also start the interview for that person so the timer spins So both the phone number and the candidate names will be on the projector Yes the queue manager will sit at a laptop Yes the induction process will have a reliable Internet connection No you have to to make it cloud hosted real time application not a local application But for MVP first design it locally developed locally and then we will deploy it somewhere where it is more suitable I don't want to explore such tasks that or such platforms that are expensive I want to see the most cheapest and most reliable option possible


Yes. With these changes, the workflow is much clearer. I would lock down the MVP around the actual induction-day process rather than adding unnecessary features.

## Updated core workflow

The candidate lifecycle should be:

```text
REGISTERED
    │
    │ candidate physically arrives
    ▼
ARRIVED
    │
    │ queue manager assigns panel
    ▼
QUEUED
    │
    │ queue manager calls candidate
    ▼
INTERVIEWING
    │
    │ interview finished
    ▼
COMPLETED
```

And if someone leaves temporarily:

```text
QUEUED
   ↓
SKIPPED
   ↓
back into QUEUE
```

The important distinction is that **everyone imported from Google Forms is already registered**. We don't need a separate "registered" action from the queue manager.

---

# 1. Google Forms CSV import

This is one of the things we should design carefully.

Suppose the first CSV contains:

```text
Form Number | Name       | Email
101         | Ali Khan   | ali@...
102         | Ahmed      | ahmed@...
103         | Hamza      | hamza@...
```

The queue manager imports it.

The system stores:

```text
101 → Ali Khan
102 → Ahmed
103 → Hamza
```

with status:

```text
REGISTERED
```

Then, later, three more people register.

Google Forms export now gives:

```text
101
102
103
104
105
106
```

The queue manager imports the CSV again.

The system checks:

```text
101 → already exists → ignore
102 → already exists → ignore
103 → already exists → ignore

104 → new → insert
105 → new → insert
106 → new → insert
```

So the **Google Form number should be a unique identifier** in our database.

Conceptually:

```text
Candidate
----------------
id
form_number UNIQUE
name
email
...
status
created_at
```

The `form_number` is what prevents duplicates.

### One important decision

If someone changes their Google Form response, should re-importing the CSV update their existing candidate information?

I would say **yes**.

So import isn't simply:

```text
new form number → INSERT
```

It should effectively be:

```text
form number exists?
       │
    ┌──┴──┐
   YES    NO
    │      │
 UPDATE   INSERT
```

That means if someone corrects their name/email/application response, the system gets the latest information.

---

# 2. Arrival is separate from registration

This is an important distinction.

Imagine 200 people registered through Google Forms, but only 120 show up.

The queue manager sees:

```text
Registered: 200
Arrived:     87
Waiting:     14
Interviewing: 2
Completed:   71
```

When someone physically arrives:

```text
Candidate #184

Status: REGISTERED

[ MARK AS ARRIVED ]
```

Then:

```text
REGISTERED
     ↓
ARRIVED
```

And only arrived candidates can enter the interview queue.

That prevents the queue from being filled with people who haven't actually shown up.

---

# 3. Queue Manager flow

I think the queue manager's workflow should become extremely simple.

### Candidate arrives

Search:

```text
Search candidate...
```

Maybe search by:

* Form number
* Name
* Email

Then:

```text
#184
Ali Khan
B33

Status: Registered

[Mark Arrived]
```

After clicking:

```text
#184
Ali Khan
B33

Status: Arrived

[Add to Queue]
```

Then:

```text
#184
Ali Khan
B33

Position: 5

[Panel 1] [Panel 2]
[Skip]
```

---

# 4. Assigning panels

We can make this intelligent without making the system complicated.

Suppose:

```text
Panel 1 → Interviewing
Panel 2 → Available
```

Queue manager selects:

```text
#184 Ali Khan

[Assign]
```

System can immediately suggest:

```text
Panel 2
```

because it is available.

But the queue manager can override it:

```text
Assign to:

● Panel 1
○ Panel 2
```

This gives the queue manager control while reducing unnecessary decisions.

---

# 5. Starting the interview

This is now clear.

The **queue manager controls the start**.

For example:

```text
Panel 1

Current:
#176 Ahmed

Next:
#184 Ali
```

Queue manager clicks:

**Call #184**

At that exact moment the backend records:

```text
candidate = 184
panel = 1
status = INTERVIEWING
started_at = server_timestamp
```

And all connected clients update.

### Panel 1

```text
CURRENT CANDIDATE

#184
Ali Khan

17:32
```

### Projector

```text
MICROSOFT CLUB GIKI

NOW INTERVIEWING

#184
Ali Khan

17:32
```

### Queue Manager

```text
Panel 1
#184 Ali Khan
INTERVIEWING
17:32
```

### Other panelists

Their dashboard updates too.

This is exactly where realtime communication becomes useful.

---

# 6. Projector

Since you confirmed both name and form number should be shown, I'd make the projector display:

```text
┌────────────────────────────────────┐
│                                    │
│       MICROSOFT CLUB GIKI          │
│                                    │
│         NOW INTERVIEWING           │
│                                    │
│              #184                  │
│           Ali Khan                 │
│                                    │
│              17:32                 │
│                                    │
└────────────────────────────────────┘
```

When the candidate hasn't entered yet:

```text
┌────────────────────────────────────┐
│                                    │
│       MICROSOFT CLUB GIKI          │
│                                    │
│             NEXT                   │
│                                    │
│              #184                  │
│           Ali Khan                 │
│                                    │
│          PANEL 1                   │
│                                    │
└────────────────────────────────────┘
```

And when there is nobody being interviewed:

```text
NO CURRENT INTERVIEW

Please wait for the next candidate.
```

We can make this one `/display` page whose content changes based on state, rather than actually building two separate applications.

---

# 7. Skip

Your use case makes sense.

Suppose:

```text
1. #101
2. #102
3. #103
4. #104
```

#102 has gone somewhere.

Queue manager clicks:

**Skip**

We should **not mark them as completed**.

Instead:

```text
#101
#103
#104
...
#102
```

And #102 gets:

```text
Status: SKIPPED
```

The queue manager can later click:

**Return to Queue**

and place them wherever appropriate.

This is different from removing the candidate entirely.

---

# 8. Open Application

Yes, this can be very straightforward.

Every candidate record has the Google Form/application URL.

Panelist clicks:

**Open Application**

and the browser opens the corresponding Google Form response/application.

There is one thing we'll need to establish when we get the actual CSV:

**How do we construct/find the URL for an individual candidate's Google Form response?**

If the CSV only contains the candidate's answers and form number, there may not be an individual response URL available directly.

If your current process is that you open the Google Forms response spreadsheet and locate the person's row, then we may need a slightly different solution.

We'll determine that when you show me an example CSV.

---

# 9. Panel discussion

I'd keep this exactly as you described.

For example:

```text
┌───────────────────────────────────────┐
│ Candidate #184                        │
├───────────────────────────────────────┤
│                                       │
│ Yawar                                 │
│ Strong backend experience.             │
│                                       │
│ Hamza                                 │
│ Agree. Ask about distributed systems. │
│                                       │
│ Maimoona                              │
│ Communication is good.                │
│                                       │
│ ┌───────────────────────────────────┐ │
│ │ Type a message...                 │ │
│ └───────────────────────────────────┘ │
└───────────────────────────────────────┘
```

And the database relationship should essentially be:

```text
Candidate
   │
   └── Interview
          │
          ├── Panel
          ├── Started At
          ├── Ended At
          ├── Evaluation
          │
          └── Messages
                ├── Message
                ├── Author
                └── Timestamp
```

This is better than attaching messages directly to the candidate because it leaves room for **multiple interview rounds** later.

---

# 10. Evaluation

One thing I'd like to keep flexible in the MVP is the evaluation criteria.

Rather than hard-coding something like:

```text
Technical: 10
Communication: 10
Problem solving: 10
```

we can make the evaluation criteria configurable by Admin.

For example:

```text
Technical Skills      /10
Problem Solving       /10
Communication         /10
Teamwork              /10
Overall Comments
```

Then next year's induction can have different criteria without changing the code.

---

# 11. Architecture

Since you specifically want:

* Cloud hosted
* Realtime
* Cheap
* Reliable
* Locally developed first
* No unnecessarily expensive infrastructure

I would **not** start by thinking about AWS EC2, Kubernetes, Docker servers, etc.

For this application, that would be unnecessary.

A simple architecture is enough:

```text
                 Internet
                    │
                    ▼
          ┌──────────────────┐
          │    Frontend      │
          │ React + TypeScript│
          └────────┬─────────┘
                   │
          ┌────────▼─────────┐
          │     Backend      │
          │ API + Realtime   │
          └────────┬─────────┘
                   │
          ┌────────▼─────────┐
          │    PostgreSQL    │
          │                  │
          │ Candidates       │
          │ Interviews       │
          │ Queue            │
          │ Messages        │
          │ Evaluations      │
          │ Users            │
          └──────────────────┘
```

For this particular project, **Supabase is a very strong candidate for the backend/database/realtime layer**, because the application naturally needs PostgreSQL plus realtime updates.

Then the frontend can be deployed separately on something like Cloudflare Pages.

That gives us:

```text
React
   ↓
Supabase
   ├── PostgreSQL
   ├── Authentication
   ├── Realtime
   └── API
```

We should still compare the current free/cheap limits before deployment, because those can change. When we reach deployment, I'll check the current pricing/limits rather than assuming today's limits.

---

# 12. Local development

Locally, we'd run the application in a way that closely resembles production.

Something like:

```text
Microsoft Club Induction
│
├── frontend/
│   └── React + TypeScript
│
├── backend/
│   └── API
│
├── database/
│   └── PostgreSQL
│
└── README
```

But if we use Supabase heavily, we can also use the **Supabase local development stack** so the local environment resembles the hosted version.

The goal should be:

```text
LOCAL

Browser
   ↓
Local Frontend
   ↓
Local Supabase
   ↓
Local PostgreSQL


PRODUCTION

Browser
   ↓
Cloudflare Pages
   ↓
Supabase Cloud
   ↓
PostgreSQL
```

So deployment doesn't require redesigning the application.

---

# 13. One architectural decision I would make now

I would treat an **interview** as its own entity.

Not:

```text
Candidate
   ↓
Status
```

but:

```text
Candidate
   │
   └── Interview
          │
          ├── Panel
          ├── Queue position
          ├── Started at
          ├── Ended at
          ├── Status
          ├── Discussion
          └── Evaluation
```

This gives us flexibility later.

For example, if someone gets a second interview:

```text
Candidate #184

Interview 1
Panel 1
Completed

Interview 2
Panel 2
Completed
```

without having to redesign the database.

---

# 14. MVP database, roughly

I think we're converging toward something like:

```text
users
────────────────
id
username
password_hash
name
role
active


inductions
────────────────
id
name
date
status


candidates
────────────────
id
induction_id
form_number UNIQUE
name
email
batch
application_data
status
arrived_at


panels
────────────────
id
induction_id
name


panel_members
────────────────
panel_id
user_id


interviews
────────────────
id
candidate_id
panel_id
status
started_at
ended_at


messages
────────────────
id
interview_id
user_id
message
created_at


evaluations
────────────────
id
interview_id
...
created_at
```

And later we can add:

```text
queue_events
audit_logs
evaluation_criteria
notifications
```

if needed.

---

## One thing I need from you before we start coding

I'd like to see the **actual Google Forms CSV structure**.

You can upload a sample CSV with fake/anonymized candidate information if you don't want to share the real data.

I specifically want to see:

1. What the Google Form number column looks like
2. What candidate fields exist
3. Whether the individual application/response can be opened from the exported data
4. Whether there are columns that should be displayed to panelists
5. Whether there are fields that should remain queue-manager/admin-only

Once we have that, I think we can move directly into the **MVP specification**, including the exact pages, database schema, API/realtime events, and project structure.


Yes. I checked the CSV you uploaded. The structure confirms what we need.

The form currently has the general information fields:

* Full Name
* Email Address
* Registration Number
* Phone Number (WhatsApp)
* Department
* Batch

There are then many team-specific/application questions, but **we will not import those into the induction system for MVP**.

## Candidate data for MVP

Each candidate record should therefore initially contain only:

```text
Candidate
├── Google Form Number
├── Full Name
├── Email
├── Registration Number
├── Phone Number
├── Department
├── Batch
└── Status
```

One distinction I want to make clear:

### Google Form Number vs Registration Number

From the CSV I can see a `Registration Number` field, but I don't see a separate column explicitly called something like `Google Form Number`.

So we need to establish what you mean by **Google Form number**.

If by Google Form number you mean the **row/response number assigned by the Google Forms response sheet**, then that should be stored separately:

```text
google_form_number
registration_number
```

For example:

```text
Google Form #184
Registration #2023-CS-123
Name: Ali Khan
```

The **Google Form number should be the unique identifier used for CSV deduplication**, because, as you explained, it never changes for that candidate.

If instead the "Google Form number" is actually the `Registration Number` column in your CSV, then we can use that as the unique identifier. I don't want to assume this without confirming.

## CSV import behavior

The import system will work like this:

```text
                CSV IMPORT
                    │
                    ▼
          Read Google Form Number
                    │
              Does it exist?
              /           \
            YES            NO
             │              │
             ▼              ▼
      Update general      Create
       information       candidate
             │              │
             └──────┬───────┘
                    ▼
             Keep current
              interview
               status
```

That last part is important.

Suppose candidate `#184` has already:

```text
ARRIVED
→ QUEUED
→ INTERVIEWING
```

and someone imports the Google Forms CSV again because 5 new people registered.

We **must not reset #184 back to REGISTERED**.

We only update their application/general information.

So the import should never overwrite operational induction state.

---

## Candidate status

I think our final status model should be:

```text
REGISTERED
    ↓
ARRIVED
    ↓
QUEUED
    ↓
INTERVIEWING
    ↓
COMPLETED
```

With:

```text
QUEUED
   ↓
SKIPPED
   ↓
QUEUED
```

And potentially:

```text
ARRIVED → LEFT / ABSENT
```

later if we find that useful.

The initial CSV import puts everyone at:

```text
REGISTERED
```

Then the queue manager handles the physical process.

---

## What the panel sees

When candidate #184 enters Panel 1, the panel doesn't need to dig through the whole application.

They see:

```text
┌──────────────────────────────────────────┐
│ Candidate #184                           │
│                                          │
│ Ali Khan                                 │
│ Registration: 2023-CS-123                │
│ Batch: B33                               │
│ Department: Computer Science             │
│ Email: ali@example.com                   │
│ Phone: 03xx-xxxxxxx                      │
│                                          │
│ [ Open Application ]                     │
├──────────────────────────────────────────┤
│ Interview                                │
│                                          │
│ 17:32                                    │
│                                          │
│ Panel Discussion                         │
│ ──────────────────────────────────────── │
│ ...                                      │
├──────────────────────────────────────────┤
│ Evaluation                               │
│ ...                                      │
└──────────────────────────────────────────┘
```

And **Open Application** can take them to the original Google Form/application information when we determine the exact URL mechanism.

For MVP, the panel doesn't need all those questions directly inside our database.

---

## This also makes the system much cleaner

We're essentially separating the data into two categories:

### Application data

Comes from Google Forms:

```text
Name
Email
Registration Number
Phone
Department
Batch
```

Potentially more application questions later.

### Induction data

Created by our system:

```text
Arrival
Queue position
Assigned panel
Interview status
Interview start/end time
Panel discussion
Evaluation
Skip history
```

That's the right separation because the Google Form is the **source of candidate registration**, while our application is the **source of truth for what happens during the induction**.

I think we now have enough information to move from requirements gathering to the actual **MVP specification and architecture**. The next step I'd take is to define the exact screens and user flows first, then the database schema, and only after that start implementing.
