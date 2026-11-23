export const questionSets = [
  {
    id: "starter",
    title: "Starter Mix",
    description: "A little bit of everything, including true or false.",
    questions: [
      { type: "multiple", question: "Which planet has the most prominent ring system?", options: ["Mars", "Saturn", "Venus", "Mercury"], answer: 1 },
      { type: "boolean", question: "Octopuses have three hearts.", options: ["True", "False"], answer: 0 },
      { type: "multiple", question: "What is the largest ocean on Earth?", options: ["Atlantic", "Indian", "Pacific", "Arctic"], answer: 2 },
      { type: "boolean", question: "The Great Wall of China is visible from the Moon with the naked eye.", options: ["True", "False"], answer: 1 },
      { type: "multiple", question: "Which instrument has 88 keys on a standard version?", options: ["Piano", "Violin", "Trumpet", "Flute"], answer: 0 },
      { type: "boolean", question: "Sound travels faster in water than in air.", options: ["True", "False"], answer: 0 },
      { type: "multiple", question: "What do bees collect from flowers to make honey?", options: ["Pollen", "Nectar", "Sap", "Dew"], answer: 1 },
      { type: "boolean", question: "A leap year always has 365 days.", options: ["True", "False"], answer: 1 }
    ]
  },
  {
    id: "thanksgiving",
    title: "Thanksgiving",
    description: "Food, traditions, and a little Thanksgiving history.",
    questions: [
      { type: "multiple", question: "What day of the week is U.S. Thanksgiving celebrated?", options: ["Monday", "Thursday", "Friday", "Sunday"], answer: 1 },
      { type: "boolean", question: "Canada celebrates Thanksgiving in October.", options: ["True", "False"], answer: 0 },
      { type: "multiple", question: "Which pie is a Thanksgiving classic?", options: ["Key lime pie", "Pumpkin pie", "Lemon meringue pie", "Banoffee pie"], answer: 1 },
      { type: "multiple", question: "Which city hosts Macy's Thanksgiving Day Parade?", options: ["Chicago", "Boston", "New York City", "Philadelphia"], answer: 2 },
      { type: "boolean", question: "The wishbone is found in a turkey.", options: ["True", "False"], answer: 0 },
      { type: "multiple", question: "Which U.S. president proclaimed a national Thanksgiving Day in 1863?", options: ["George Washington", "Abraham Lincoln", "Theodore Roosevelt", "Woodrow Wilson"], answer: 1 },
      { type: "multiple", question: "Which bird is a traditional Thanksgiving centerpiece?", options: ["Chicken", "Duck", "Turkey", "Goose"], answer: 2 },
      { type: "boolean", question: "U.S. Thanksgiving falls on the fourth Thursday of November.", options: ["True", "False"], answer: 0 }
    ]
  },
  {
    id: "christmas",
    title: "Christmas",
    description: "Holiday stories, songs, and festive traditions.",
    questions: [
      { type: "multiple", question: "On what date is Christmas Day celebrated?", options: ["December 24", "December 25", "December 26", "January 1"], answer: 1 },
      { type: "boolean", question: "Advent comes before Christmas.", options: ["True", "False"], answer: 0 },
      { type: "multiple", question: "What color is Rudolph's nose?", options: ["Blue", "Gold", "Red", "Green"], answer: 2 },
      { type: "multiple", question: "Who wrote A Christmas Carol?", options: ["Jane Austen", "Charles Dickens", "Mark Twain", "Lewis Carroll"], answer: 1 },
      { type: "boolean", question: "Boxing Day is observed on December 26.", options: ["True", "False"], answer: 0 },
      { type: "multiple", question: "Which plant is known for its bright red holiday leaves?", options: ["Poinsettia", "Sunflower", "Daisy", "Lavender"], answer: 0 },
      { type: "multiple", question: "Who composed the music for The Nutcracker ballet?", options: ["Mozart", "Beethoven", "Tchaikovsky", "Vivaldi"], answer: 2 },
      { type: "multiple", question: "What brings Frosty the Snowman to life in the song?", options: ["A scarf", "A magic hat", "A snowflake", "A bell"], answer: 1 }
    ]
  }
];

export function validateQuestions(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30) throw new Error("Provide 1 to 30 questions.");
  return input.map((item, index) => {
    const type = item?.type;
    const question = String(item?.question ?? "").trim();
    const options = type === "boolean" ? ["True", "False"] : item?.options;
    const answer = item?.answer;
    if (question.length > 160 || (Array.isArray(options) && options.some(option => typeof option === "string" && option.length > 60))) {
      throw new Error(`Question ${index + 1} is too long for phone screens (160 characters for questions, 60 for answers).`);
    }
    if (!["multiple", "boolean"].includes(type) || !question || !Array.isArray(options) || options.length !== (type === "boolean" ? 2 : 4) || options.some(option => typeof option !== "string" || !option.trim()) || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new Error(`Question ${index + 1} has an invalid type, options, or answer.`);
    }
    return { type, question, options: options.map(option => option.trim()), answer };
  });
}
