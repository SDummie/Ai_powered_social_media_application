import { PrismaClient, FollowStatus, MediaType, NotificationType, Role } from "@prisma/client";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

async function main() {
  // Clean slate for local/dev seeding
  await prisma.like.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.postHashtag.deleteMany();
  await prisma.storyView.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.message.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.postMedia.deleteMany();
  await prisma.post.deleteMany();
  await prisma.story.deleteMany();
  await prisma.reel.deleteMany();
  await prisma.hashtag.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("password123", 10);

  // 1) Users (10)
  const users = [];
  const usernames = new Set<string>();

  while (users.length < 10) {
    const username = faker.internet.userName().replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
    if (!username || usernames.has(username)) continue;
    usernames.add(username);

    users.push(
      await prisma.user.create({
        data: {
          username,
          email: faker.internet.email().toLowerCase(),
          emailVerified: faker.datatype.boolean({ probability: 0.8 }) ? new Date() : null,
          passwordHash,
          name: faker.person.fullName(),
          bio: faker.person.jobTitle(),
          website: faker.internet.url(),
          location: faker.location.city(),
          avatarUrl: `https://i.pravatar.cc/150?u=${faker.string.uuid()}`,
          isPrivate: faker.datatype.boolean({ probability: 0.3 }),
          isVerified: faker.datatype.boolean({ probability: 0.15 }),
          role: Role.USER,
        },
      }),
    );
  }

  // 2) Hashtags (pool for PostHashtag join)
  const hashtagNames = uniq(
    Array.from({ length: 60 }, () => faker.word.noun().toLowerCase()).map((n) => n.replace(/[^a-zA-Z0-9_]/g, "")),
  ).filter(Boolean);

  const hashtags = [];
  for (const name of hashtagNames) {
    hashtags.push(
      await prisma.hashtag.upsert({
        where: { name },
        update: {},
        create: { name },
      }),
    );
  }

  // 3) Posts (30 per user)
  const posts = [];
  for (const author of users) {
    for (let i = 0; i < 30; i++) {
      const mediaCount = faker.number.int({ min: 1, max: 4 });

      const media = Array.from({ length: mediaCount }, (_, order) => {
        const w = faker.number.int({ min: 600, max: 1200 });
        const h = faker.number.int({ min: 600, max: 1200 });
        const sig = `${author.id}-${i}-${order}`;

        return {
          url: `https://images.unsplash.com/photo-1520975969010-0e9f0a5b8f65?auto=format&fit=crop&w=${w}&h=${h}&q=80&sat=-10&sig=${sig}`,
          type: faker.datatype.boolean({ probability: 0.1 }) ? MediaType.VIDEO : MediaType.IMAGE,
          order,
        };
      });

      const chosenHashtags = uniq(
        Array.from({ length: 5 }, () => pickRandom(hashtags)).map((h) => h.id),
      );

      const location = faker.datatype.boolean({ probability: 0.35 }) ? faker.location.city() : null;
      const caption = faker.lorem.sentences({ min: 1, max: 3 });

      const post = await prisma.post.create({
        data: {
          authorId: author.id,
          caption,
          location,
          isAiGenerated: faker.datatype.boolean({ probability: 0.15 }),
          media: {
            create: media.map((m) => ({
              url: m.url,
              type: m.type,
              order: m.order,
            })),
          },
          hashtags: {
            create: chosenHashtags.map((hashtagId) => ({ hashtagId })),
          },
        },
      });

      posts.push(post);

      // Seed a few comments per post (kept modest)
      const commentCount = faker.number.int({ min: 0, max: 3 });
      for (let c = 0; c < commentCount; c++) {
        const commenter = pickRandom(users.filter((u) => u.id !== author.id));
        const text = faker.lorem.sentence({ min: 5, max: 18 });
        await prisma.comment.create({
          data: {
            authorId: commenter.id,
            postId: post.id,
            text,
          },
        });
      }
    }
  }

  // 4) Stories (5 per user) + views
  for (const author of users) {
    for (let i = 0; i < 5; i++) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const story = await prisma.story.create({
        data: {
          authorId: author.id,
          mediaUrl: `https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&h=1600&q=80&sig=${author.id}-${i}`,
          mediaType: MediaType.IMAGE,
          textOverlay: faker.datatype.boolean({ probability: 0.4 }) ? faker.lorem.words(3) : null,
          expiresAt,
        },
      });

      const viewerCount = faker.number.int({ min: 0, max: 6 });
      const viewerCandidates = users.filter((u) => u.id !== author.id);
      const viewerIds = uniq(
        Array.from({ length: viewerCount }, () => pickRandom(viewerCandidates).id),
      );

      await Promise.all(
        viewerIds.map((viewerId) =>
          prisma.storyView.create({
            data: { storyId: story.id, viewerId },
          }),
        ),
      );
    }
  }

  // 5) Random follows between users
  for (const follower of users) {
    for (const following of users) {
      if (follower.id === following.id) continue;
      if (!faker.datatype.boolean({ probability: 0.12 })) continue;

      const status: FollowStatus = following.isPrivate ? FollowStatus.PENDING : FollowStatus.ACCEPTED;
      await prisma.follow.create({
        data: {
          followerId: follower.id,
          followingId: following.id,
          status,
        },
      }).catch(() => void 0);
    }
  }

  // 6) Messages (10 between random user pairs)
  for (let i = 0; i < 10; i++) {
    const sender = pickRandom(users);
    const receiver = pickRandom(users.filter((u) => u.id !== sender.id));
    await prisma.message.create({
      data: {
        senderId: sender.id,
        receiverId: receiver.id,
        text: faker.lorem.sentence({ min: 5, max: 18 }),
        seenAt: faker.datatype.boolean({ probability: 0.35 }) ? new Date() : null,
      },
    });
  }

  // 7) Likes (lightweight: post likes + bookmarks) to make counts meaningful
  const allUserIds = users.map((u) => u.id);
  for (const post of posts) {
    const likerCount = faker.number.int({ min: 0, max: 18 });
    const likers = uniq(
      Array.from({ length: likerCount }, () => pickRandom(allUserIds.filter((id) => id !== post.authorId))),
    );

    await Promise.all(
      likers.map((userId) =>
        prisma.like.create({
          data: { userId, postId: post.id },
        }).catch(() => void 0),
      ),
    );
  }

  for (const user of users) {
    const bookmarkCount = faker.number.int({ min: 5, max: 20 });
    const candidatePosts = posts.filter((p) => p.authorId !== user.id);
    for (let i = 0; i < bookmarkCount; i++) {
      const post = pickRandom(candidatePosts);
      await prisma.bookmark.create({
        data: { userId: user.id, postId: post.id },
      }).catch(() => void 0);
    }
  }

  // 8) Notifications (20 per user)
  for (const recipient of users) {
    for (let i = 0; i < 20; i++) {
      const type = pickRandom(Object.values(NotificationType) as NotificationType[]);

      if (type === NotificationType.FOLLOW) {
        // Someone following you
        const follower = pickRandom(users.filter((u) => u.id !== recipient.id));
        await prisma.notification.create({
          data: {
            type,
            userId: recipient.id,
            actorId: follower.id,
            message: `${follower.username} followed you`,
            isRead: false,
          },
        });
      } else if (type === NotificationType.FOLLOW_REQUEST) {
        // Only makes sense for private accounts, but we still seed it for realism
        const follower = pickRandom(users.filter((u) => u.id !== recipient.id));
        await prisma.notification.create({
          data: {
            type,
            userId: recipient.id,
            actorId: follower.id,
            message: `${follower.username} requested to follow you`,
            isRead: false,
          },
        });
      } else if (type === NotificationType.LIKE) {
        // Someone liked your post
        const myPosts = posts.filter((p) => p.authorId === recipient.id);
        const myPost = pickRandom(myPosts);
        const liker = pickRandom(users.filter((u) => u.id !== recipient.id));
        await prisma.notification.create({
          data: {
            type,
            userId: recipient.id,
            actorId: liker.id,
            postId: myPost.id,
            message: `${liker.username} liked your post`,
            isRead: false,
          },
        });
      } else if (type === NotificationType.STORY_VIEW) {
        const myStories = await prisma.story.findMany({
          where: { authorId: recipient.id },
          select: { id: true },
        });
        const story = pickRandom(myStories);
        const viewer = pickRandom(users.filter((u) => u.id !== recipient.id));
        await prisma.notification.create({
          data: {
            type,
            userId: recipient.id,
            actorId: viewer.id,
            postId: null,
            message: `${viewer.username} viewed your story`,
            isRead: false,
          },
        });
      } else if (type === NotificationType.MESSAGE) {
        const message = await prisma.message.findFirst({
          where: {
            receiverId: recipient.id,
          },
          select: { id: true },
          orderBy: { createdAt: "desc" },
        });

        if (!message) continue;
        const sender = await prisma.message.findFirst({
          where: { id: message.id },
          select: { senderId: true },
        });

        await prisma.notification.create({
          data: {
            type,
            userId: recipient.id,
            actorId: sender?.senderId ?? null,
            message: `New message from ${users.find((u) => u.id === sender?.senderId)?.username ?? "someone"}`,
            isRead: false,
          },
        });
      } else {
        // COMMENT / MENTION are still useful placeholders in the UI,
        // even if we haven't fully modelled comment/reply moderation in seed.
        const actor = pickRandom(users.filter((u) => u.id !== recipient.id));
        await prisma.notification.create({
          data: {
            type,
            userId: recipient.id,
            actorId: actor.id,
            message: `${actor.username} ${type === NotificationType.COMMENT ? "commented on" : "mentioned you in"} a post`,
            isRead: false,
          },
        });
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

