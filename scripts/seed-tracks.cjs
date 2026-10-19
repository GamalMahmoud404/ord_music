const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const tracks = [
  { title: "Glass Hours", artist: "Vera Lux", album: "Glass Hours", duration: "3:21", mood: "Late night", color: "#8deaff", cover: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=85", audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", order: 1 },
  { title: "Neon Umbrella", artist: "Vera Lux", album: "Glass Hours", duration: "3:04", mood: "Energised", color: "#ffc477", cover: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=900&q=85", audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", order: 2 },
  { title: "Tram 28", artist: "Vera Lux", album: "Glass Hours", duration: "3:47", mood: "Calm", color: "#82f2c7", cover: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=85", audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", order: 3 },
  { title: "Paper Moons", artist: "Vera Lux", album: "Glass Hours", duration: "3:42", mood: "Dreamy", color: "#ff9bd0", cover: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=85", audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3", order: 4 },
  { title: "Blue Before Day", artist: "Vera Lux", album: "Glass Hours", duration: "4:05", mood: "Melancholy", color: "#a9c5ff", cover: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=85", audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3", order: 5 },
  { title: "Honey Static", artist: "Vera Lux", album: "Glass Hours", duration: "3:36", mood: "Soulful", color: "#ffc4a0", cover: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=900&q=85", audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3", order: 6 },
  { title: "Last Train Home", artist: "Vera Lux", album: "Glass Hours", duration: "4:18", mood: "Late night", color: "#8deaff", cover: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=85", audio: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3", order: 7 },
];

async function main() {
  for (const track of tracks) {
    await prisma.track.upsert({
      where: { title: track.title },
      update: track,
      create: track,
    });
  }
  console.log(`Seeded ${tracks.length} tracks into MongoDB.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
