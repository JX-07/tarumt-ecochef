const ingredientIcons: Array<[string[], string]> = [
  [["avocado"],"🥑"],[["bread","toast","mantou","bun"],"🍞"],[["carrot"],"🥕"],[["egg"],"🥚"],[["garlic"],"🧄"],[["lemon","lime"],"🍋"],[["onion","shallot","scallion","spring onion","青葱"],"🧅"],[["spinach","kale","lettuce","cabbage","bok choy"],"🥬"],[["tomato"],"🍅"],
  [["apple"],"🍎"],[["banana"],"🍌"],[["grape"],"🍇"],[["orange","mandarin"],"🍊"],[["strawberry","berry"],"🍓"],[["watermelon"],"🍉"],[["pineapple"],"🍍"],[["mango"],"🥭"],[["peach"],"🍑"],[["pear"],"🍐"],[["coconut"],"🥥"],[["kiwi"],"🥝"],
  [["broccoli"],"🥦"],[["corn"],"🌽"],[["potato"],"🥔"],[["sweet potato"],"🍠"],[["cucumber"],"🥒"],[["pepper","capsicum","chilli","chili"],"🌶️"],[["mushroom"],"🍄"],[["pea","bean","lentil"],"🫘"],[["olive"],"🫒"],
  [["milk"],"🥛"],[["cheese"],"🧀"],[["butter"],"🧈"],[["yogurt","yoghurt"],"🥣"],[["coffee"],"☕"],[["tea"],"🍵"],[["juice"],"🧃"],[["water"],"💧"],[["wine"],"🍷"],[["beer"],"🍺"],[["cocktail"],"🍹"],
  [["chicken","drumstick"],"🍗"],[["beef","steak"],"🥩"],[["pork","bacon"],"🥓"],[["fish","salmon","tuna"],"🐟"],[["prawn","shrimp","虾","虾滑"],"🦐"],[["crab"],"🦀"],[["lobster"],"🦞"],[["squid","octopus"],"🦑"],
  [["rice","nasi"],"🍚"],[["noodle","ramen","pasta","spaghetti","粉","面"],"🍜"],[["pizza"],"🍕"],[["burger"],"🍔"],[["sandwich"],"🥪"],[["taco"],"🌮"],[["soup","broth","hotpot"],"🍲"],[["curry"],"🍛"],[["salad"],"🥗"],[["dumpling"],"🥟"],[["sushi"],"🍣"],
  [["flour"],"🌾"],[["sugar","honey"],"🍯"],[["salt"],"🧂"],[["oil"],"🫗"],[["herb","parsley","cilantro","basil"],"🌿"],[["cake"],"🍰"],[["cookie","biscuit"],"🍪"],[["chocolate"],"🍫"],[["ice cream"],"🍨"]
];

export function ingredientEmojiFor(name:string,fallback="?"){
  const normalized=name.trim().toLowerCase();
  if(!normalized)return fallback;
  return ingredientIcons.find(([terms])=>terms.some(term=>normalized.includes(term)))?.[1]??fallback;
}

export const selectableIngredientIcons=["🥬","🥕","🥚","🧄","🍋","🧅","🥑","🍞","🍅","🍎","🍌","🍇","🥦","🥛","🧀","🍗","🐟","🍚","🥩","🥓","🦐","🦀","🍜","🍲","🍛","🥗","🥟","🍕","☕","🍵","🧃","🌾","🌿","🧂","🍰"];
